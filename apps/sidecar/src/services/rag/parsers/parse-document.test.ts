import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../../../infra/memory-file-system.js';
import { detectFormat, parseDocument } from './parse-document.js';

const pathFor = (name: string): string => join(process.cwd(), 'parser-tests', name);

async function parse(name: string, bytes: Uint8Array | string) {
  const fs = new MemoryFileSystem();
  const path = pathFor(name);
  const written = await fs.writeFile(path, bytes);
  expect(written.ok).toBe(true);
  return parseDocument(path, fs);
}

describe('document parsers', () => {
  it('detects the supported extensions case-insensitively', () => {
    expect(detectFormat('readme.MD')).toMatchObject({ ok: true, value: 'markdown' });
    expect(detectFormat('app.tsx')).toMatchObject({ ok: true, value: 'code' });
    expect(detectFormat('page.htm')).toMatchObject({ ok: true, value: 'html' });
    expect(detectFormat('archive.bin')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it.each([
    ['guide.md', '# Guide\r\n\r\nBody', 'markdown'],
    ['notes.log', 'line one\rline two', 'text'],
    ['source.rs', 'fn main() {}', 'code'],
  ] as const)('parses raw text format %s and normalizes newlines', async (name, source, format) => {
    const result = await parse(name, source);
    expect(result).toMatchObject({ ok: true, value: { format } });
    if (result.ok) expect(result.value.text).toBe(source.replace(/\r\n?/g, '\n'));
  });

  it('parses PDF pages and separates their text', async () => {
    const result = await parse('sample.pdf', makePdf(['First page', 'Second page']));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.text).toContain('First page\n\nSecond page');
  });

  it('converts DOCX headings to markdown', async () => {
    const documentXml =
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Doc heading</w:t></w:r></w:p><w:p><w:r><w:t>Paragraph text</w:t></w:r></w:p></w:body></w:document>';
    const bytes = makeZip([
      [
        '[Content_Types].xml',
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ],
      [
        '_rels/.rels',
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ],
      ['word/document.xml', documentXml],
    ]);
    const result = await parse('sample.docx', bytes);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.text).toContain('# Doc heading');
  });

  it('converts HTML headings and removes scripts and styles', async () => {
    const result = await parse(
      'page.html',
      '<h1>Page title</h1><p>Visible</p><script>secret()</script><style>.x { color:red }</style>',
    );
    expect(result).toMatchObject({ ok: true, value: { format: 'html', title: 'Page title' } });
    if (result.ok) {
      expect(result.value.text).toContain('# Page title');
      expect(result.value.text).toContain('Visible');
      expect(result.value.text).not.toContain('secret');
      expect(result.value.text).not.toContain('color:red');
    }
  });

  it('allows exactly 20 MB and rejects one byte more', async () => {
    const accepted = await parse('large.txt', new Uint8Array(20 * 1024 * 1024).fill(32));
    const rejected = await parse('too-large.txt', new Uint8Array(20 * 1024 * 1024 + 1).fill(32));
    expect(accepted.ok).toBe(true);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe('VALIDATION');
      expect(rejected.error.remediation).toBeDefined();
    }
  });

  it('rejects NUL bytes in text/code and strips a UTF-8 BOM', async () => {
    expect(await parse('binary.txt', new Uint8Array([65, 0, 66]))).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await parse('bom.md', new Uint8Array([0xef, 0xbb, 0xbf, 35, 32, 84]))).toMatchObject({
      ok: true,
      value: { text: '# T' },
    });
  });

  it('records a warning when invalid UTF-8 needs replacement', async () => {
    const result = await parse('invalid.txt', new Uint8Array([0xff]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe(String.fromCodePoint(0xfffd));
      expect(result.value.warnings[0]).toContain('invalid UTF-8');
    }
  });

  it('returns validation errors for corrupt PDF and DOCX files', async () => {
    const pdf = await parse('broken.pdf', 'not a pdf');
    const docx = await parse('broken.docx', 'not a docx');
    expect(pdf.ok).toBe(false);
    expect(docx.ok).toBe(false);
    if (!pdf.ok) {
      expect(pdf.error.code).toBe('VALIDATION');
      expect(pdf.error.remediation).toBeDefined();
    }
    if (!docx.ok) {
      expect(docx.error.code).toBe('VALIDATION');
      expect(docx.error.remediation).toBeDefined();
    }
  });
});

function makePdf(pages: readonly string[]): Uint8Array {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>'];
  const kids = pages.map((_, index) => `${String(3 + index * 2)} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`);
  pages.forEach((text, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${String(contentId)} 0 R >>`,
    );
    objects.push(`<< /Length ${String(Buffer.byteLength(stream))} >>\nstream\n${stream}\nendstream`);
  });
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}

function makeZip(files: readonly (readonly [string, string])[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let localOffset = 0;
  for (const [name, contents] of files) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(contents);
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(localOffset, 42);
    central.push(entry, nameBytes);
    localOffset += header.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return new Uint8Array(Buffer.concat([...local, centralBytes, end]));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
