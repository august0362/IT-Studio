import type { ChunkingConfig, DocumentFormat } from '@itstudio/schemas';
import { estimateTokens } from './token-estimate.js';

export interface DraftChunk {
  readonly ordinal: number;
  readonly text: string;
  readonly tokenCount: number;
  readonly sectionPath: readonly string[];
}

interface Piece {
  readonly text: string;
  readonly path: readonly string[];
}
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const DECLARATION =
  /^\s*(?:(?:export|default|async|public|private|static|abstract)\s+)*(?:function\s+\*?|class\s+|def\s+|fn\s+)([\w$]+)/;

/** Pure deterministic document chunker. */
export function chunkDocument(input: {
  readonly text: string;
  readonly format: DocumentFormat;
  readonly config: ChunkingConfig;
}): readonly DraftChunk[] {
  const normalized = input.text
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return [];
  const pieces =
    input.format === 'code'
      ? codePieces(normalized)
      : input.format === 'markdown' || input.format === 'html' || input.format === 'docx'
        ? headingPieces(normalized, input.config.respectHeadings)
        : [{ text: normalized, path: [] }];
  const output: DraftChunk[] = [];
  for (const piece of pieces) {
    for (const text of splitPiece(piece.text, input.config.targetTokens, input.format === 'code')) {
      const previous = output.at(-1);
      if (previous && samePath(previous.sectionPath, piece.path) && input.config.overlapTokens > 0) {
        const overlap = trailingOverlap(previous.text, input.config.overlapTokens, input.format === 'code');
        const combined = `${overlap}${overlap ? '\n' : ''}${text}`;
        output.push({
          ordinal: output.length,
          text: combined,
          tokenCount: estimateTokens(combined),
          sectionPath: piece.path,
        });
      } else output.push({ ordinal: output.length, text, tokenCount: estimateTokens(text), sectionPath: piece.path });
    }
  }
  return output;
}

function headingPieces(text: string, respect: boolean): Piece[] {
  if (!respect) return [{ text, path: [] }];
  const result: Piece[] = [];
  const trail: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    const body = current.join('\n').trim();
    if (body) result.push({ text: body, path: [...trail] });
    current = [];
  };
  for (const line of text.split('\n')) {
    const match = HEADING.exec(line);
    if (!match) {
      current.push(line);
      continue;
    }
    flush();
    const level = match[1]?.length ?? 1;
    trail.length = level - 1;
    trail.push((match[2] ?? '').trim());
  }
  flush();
  return result;
}

function codePieces(text: string): Piece[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i += 1) if (DECLARATION.exec(lines[i] ?? '')) starts.push(i);
  if (!starts.length) return [{ text, path: [] }];
  if (starts[0] !== 0) starts.unshift(0);
  const result: Piece[] = [];
  starts.forEach((start, index) => {
    const name = DECLARATION.exec(lines[start] ?? '')?.[1];
    const body = lines
      .slice(start, starts[index + 1] ?? lines.length)
      .join('\n')
      .trim();
    if (body) result.push({ text: body, path: name ? [name] : [] });
  });
  return result;
}

function splitPiece(text: string, target: number, byLine: boolean): string[] {
  const safeTarget = Math.max(1, target);
  const paragraphs = paragraphsOutsideFences(text);
  const result: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current) result.push(current);
    current = '';
  };
  for (const paragraph of paragraphs) {
    if (paragraph.atomic && estimateTokens(paragraph.text) <= safeTarget * 2) {
      const candidate = current ? `${current}\n\n${paragraph.text}` : paragraph.text;
      if (current && estimateTokens(candidate) > safeTarget) flush();
      current = current ? `${current}\n\n${paragraph.text}` : paragraph.text;
      continue;
    }
    const lineAligned = byLine || paragraph.atomic;
    const units = lineAligned ? paragraph.text.split('\n') : paragraph.text.split(/(?<=[.!?])\s+/);
    for (const unit of units) {
      if (estimateTokens(unit) > safeTarget && !lineAligned) {
        flush();
        result.push(...hardWrap(unit, safeTarget));
        continue;
      }
      const separator = current ? (lineAligned ? '\n' : ' ') : '';
      const candidate = `${current}${separator}${unit}`;
      if (current && estimateTokens(candidate) > safeTarget) {
        flush();
        current = unit;
      } else current = candidate;
    }
  }
  flush();
  return result;
}

function paragraphsOutsideFences(text: string): { text: string; atomic: boolean }[] {
  const lines = text.split('\n');
  const output: { text: string; atomic: boolean }[] = [];
  let buffer: string[] = [];
  let fenced = false;
  const flush = (atomic: boolean): void => {
    if (buffer.length) output.push({ text: buffer.join('\n'), atomic });
    buffer = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (fenced) {
        buffer.push(line);
        flush(true);
        fenced = false;
      } else {
        flush(false);
        buffer.push(line);
        fenced = true;
      }
    } else if (fenced) buffer.push(line);
    else if (!line.trim()) flush(false);
    else buffer.push(line);
  }
  flush(fenced);
  return output;
}

function hardWrap(text: string, target: number): string[] {
  const maxChars = Math.max(1, target * 4);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) chunks.push(text.slice(i, i + maxChars));
  return chunks;
}

function trailingOverlap(text: string, tokens: number, code: boolean): string {
  const units = code ? text.split('\n') : text.split(/(?<=[.!?])\s+/);
  const selected: string[] = [];
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const unit = units[i];
    if (unit === undefined) continue;
    const candidate = [unit, ...selected].join(code ? '\n' : ' ');
    if (estimateTokens(candidate) > tokens && selected.length) break;
    selected.unshift(unit);
    if (estimateTokens(candidate) >= tokens) break;
  }
  return selected.join(code ? '\n' : ' ');
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
