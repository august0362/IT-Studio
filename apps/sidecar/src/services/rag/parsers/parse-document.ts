import { basename, extname } from 'node:path';
import { convert as htmlToText } from 'html-to-text';
import type { FormatCallback } from 'html-to-text';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { z } from 'zod';
import {
  DocumentFormat,
  type AppError,
  type DocumentFormat as DocumentFormatType,
  type Result,
} from '@itstudio/schemas';
import type { IFileSystem } from '../../../ports/file-system.js';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rs',
  'go',
  'java',
  'cs',
  'cpp',
  'c',
  'h',
  'json',
  'yaml',
  'yml',
  'toml',
  'sql',
  'sh',
  'ps1',
  'css',
  'scss',
]);
const REMEDIATION = ['Choose a supported document up to 20 MB, then try again.'];
const mammothMarkdownApiSchema = z.object({
  convertToMarkdown: z.function({
    input: [z.object({ buffer: z.instanceof(Buffer) })],
    output: z.promise(z.object({ value: z.string() })),
  }),
});

export interface ParsedDocument {
  readonly text: string;
  readonly format: DocumentFormatType;
  readonly title: string;
  readonly warnings: readonly string[];
}

function validationError(message: string, remediation: readonly string[] = REMEDIATION): Result<never> {
  const error: AppError = { code: 'VALIDATION', message, remediation, retryable: false };
  return { ok: false, error };
}

export function detectFormat(path: string): Result<DocumentFormatType> {
  const extension = extname(path).slice(1).toLowerCase();
  if (extension === 'md' || extension === 'markdown') return { ok: true, value: DocumentFormat.MARKDOWN };
  if (extension === 'txt' || extension === 'log') return { ok: true, value: DocumentFormat.TEXT };
  if (extension === 'pdf') return { ok: true, value: DocumentFormat.PDF };
  if (extension === 'docx') return { ok: true, value: DocumentFormat.DOCX };
  if (extension === 'html' || extension === 'htm') return { ok: true, value: DocumentFormat.HTML };
  if (CODE_EXTENSIONS.has(extension)) return { ok: true, value: DocumentFormat.CODE };
  return validationError(`Unsupported document type: .${extension || '(none)'}.`);
}

export async function parseDocument(path: string, fileSystem: IFileSystem): Promise<Result<ParsedDocument>> {
  const format = detectFormat(path);
  if (!format.ok) return format;
  const stat = await fileSystem.stat(path);
  if (!stat.ok) return stat;
  if (!stat.value.isFile) return validationError('The selected path is not a file.');
  if (stat.value.size > MAX_FILE_BYTES) return validationError('The selected file exceeds the 20 MB limit.');
  const read = await fileSystem.readFile(path);
  if (!read.ok) return read;
  const bytes = read.value;
  if (bytes.byteLength > MAX_FILE_BYTES) return validationError('The selected file exceeds the 20 MB limit.');

  try {
    const decoded =
      format.value === DocumentFormat.PDF || format.value === DocumentFormat.DOCX
        ? { text: '', warning: false }
        : decodeText(bytes, format.value);
    if (decoded.warning === 'binary') return validationError('The selected text file appears to contain binary data.');
    const text =
      format.value === DocumentFormat.PDF
        ? await parsePdf(bytes)
        : format.value === DocumentFormat.DOCX
          ? await parseDocx(bytes)
          : format.value === DocumentFormat.HTML
            ? parseHtml(decoded.text)
            : decoded.text;
    const normalized = normalizeNewlines(text);
    const title = extractTitle(normalized) ?? basename(path, extname(path));
    const warnings = decoded.warning ? ['Some invalid UTF-8 bytes were replaced with replacement characters.'] : [];
    return { ok: true, value: { text: normalized, format: format.value, title, warnings } };
  } catch {
    const remediation =
      format.value === DocumentFormat.PDF
        ? ['Open the PDF and save a valid, unencrypted copy, then try again.']
        : format.value === DocumentFormat.DOCX
          ? ['Open the document in a word processor and save a valid .docx copy, then try again.']
          : ['Check that the selected file is valid, then try again.'];
    return validationError(`The selected ${format.value.toUpperCase()} document could not be parsed.`, remediation);
  }
}

function decodeText(bytes: Uint8Array, format: DocumentFormatType): { text: string; warning: boolean | 'binary' } {
  if (
    (format === DocumentFormat.TEXT ||
      format === DocumentFormat.CODE ||
      format === DocumentFormat.MARKDOWN ||
      format === DocumentFormat.HTML) &&
    bytes.subarray(0, Math.min(bytes.byteLength, 8192)).includes(0)
  )
    return { text: '', warning: 'binary' };
  const content = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(content), warning: false };
  } catch {
    return { text: new TextDecoder('utf-8').decode(content), warning: true };
  }
}

async function parsePdf(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: bytes.slice(), useWorkerFetch: false });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items.flatMap((item) => ('str' in item && typeof item.str === 'string' ? [item.str] : [])).join(' '),
      );
    }
    return pages.join('\n\n');
  } finally {
    await task.destroy();
  }
}

async function parseDocx(bytes: Uint8Array): Promise<string> {
  const api = mammothMarkdownApiSchema.parse(mammoth);
  const result = await api.convertToMarkdown({ buffer: Buffer.from(bytes) });
  return result.value;
}

function parseHtml(html: string): string {
  const headings: Record<string, FormatCallback> = Object.fromEntries(
    Array.from({ length: 6 }, (_, index) => [
      `markdownH${String(index + 1)}`,
      (element, walk, builder) => {
        builder.openBlock({ leadingLineBreaks: 2 });
        builder.addInline(`${'#'.repeat(index + 1)} `);
        walk(element.children, builder);
        builder.closeBlock({ trailingLineBreaks: 1 });
      },
    ]),
  );
  return htmlToText(html, {
    wordwrap: false,
    formatters: headings,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      ...Array.from({ length: 6 }, (_, index) => ({
        selector: `h${String(index + 1)}`,
        format: `markdownH${String(index + 1)}`,
      })),
    ],
  });
}

function normalizeNewlines(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTitle(text: string): string | undefined {
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(text)?.[1];
  const title = heading?.trim();
  if (!title) return undefined;
  return title;
}
