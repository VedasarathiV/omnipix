import { statSync } from 'node:fs';
import { parseOffice } from 'officeparser';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';

// Office documents for agents: read Word/Excel/PowerPoint as text, write
// new .docx/.xlsx/.pptx files. Callers jail paths (run workspace); this
// module only validates formats and caps sizes.

const MAX_READ_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 200 * 1024;
const READABLE_EXTS = new Set(['.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods']);

export async function readOffice(absPath: string): Promise<string> {
  const lower = absPath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot === -1 ? '' : lower.slice(dot);
  if (!READABLE_EXTS.has(ext)) {
    throw new Error(`Unsupported office format (want ${[...READABLE_EXTS].join(', ')})`);
  }
  let size = 0;
  try {
    size = statSync(absPath).size;
  } catch {
    throw new Error('Office file not found');
  }
  if (size > MAX_READ_BYTES) throw new Error('Office file exceeds the 10MB read cap');
  const ast = await parseOffice(absPath);
  const text = String((await ast.to('text')).value ?? '').trim();
  if (!text) throw new Error('No extractable text in this file');
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

export type DocxBlock = { style: 'h1' | 'h2' | 'p' | 'bullet'; text: string };

function toDocxParagraph(block: DocxBlock): Paragraph {
  const run = new TextRun(block.text.slice(0, 5000));
  switch (block.style) {
    case 'h1':
      return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run] });
    case 'h2':
      return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run] });
    case 'bullet':
      return new Paragraph({ bullet: { level: 0 }, children: [run] });
    default:
      return new Paragraph({ children: [run] });
  }
}

export async function writeDocx(absPath: string, blocks: DocxBlock[]): Promise<number> {
  if (!blocks.length || blocks.length > 500) throw new Error('Docx needs 1..500 blocks');
  for (const block of blocks) {
    if (!['h1', 'h2', 'p', 'bullet'].includes(block.style)) throw new Error(`Bad docx style: ${block.style}`);
    if (!block.text || !block.text.trim()) throw new Error('Docx blocks need text');
  }
  const doc = new Document({ sections: [{ children: blocks.map(toDocxParagraph) }] });
  const buffer = await Packer.toBuffer(doc);
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, buffer);
  return buffer.length;
}

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

export async function writeXlsx(absPath: string, sheets: XlsxSheet[]): Promise<number> {
  if (!sheets.length || sheets.length > 20) throw new Error('Xlsx needs 1..20 sheets');
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    if (!sheet.name.trim()) throw new Error('Sheet names must be non-empty');
    if (!sheet.rows.length || sheet.rows.length > 5000) throw new Error(`Sheet ${sheet.name} needs 1..5000 rows`);
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31));
    for (const row of sheet.rows.slice(0, 5000)) {
      ws.addRow(row.slice(0, 100).map(cell => String(cell ?? '').slice(0, 5000)));
    }
  }
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const { statSync } = await import('node:fs');
  mkdirSync(dirname(absPath), { recursive: true });
  await workbook.xlsx.writeFile(absPath);
  return statSync(absPath).size;
}

export interface PptxSlide {
  title: string;
  bullets: string[];
}

export async function writePptx(absPath: string, title: string, slides: PptxSlide[]): Promise<number> {
  if (!slides.length || slides.length > 100) throw new Error('Pptx needs 1..100 slides');
  const deck = new PptxGenJS();
  deck.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  deck.layout = 'WIDE';
  const titleSlide = deck.addSlide();
  titleSlide.addText(title.slice(0, 200) || 'Untitled', { x: 0.5, y: 2.5, w: 12.33, h: 1.5, fontSize: 40, bold: true, align: 'center' });
  for (const slide of slides.slice(0, 100)) {
    const page = deck.addSlide();
    page.addText(slide.title.slice(0, 200), { x: 0.5, y: 0.3, w: 12.33, h: 1, fontSize: 28, bold: true });
    const points = slide.bullets.filter(b => b && b.trim()).slice(0, 30).map(b => ({ text: b.slice(0, 500), options: { bullet: true } }));
    if (points.length) {
      page.addText(points as never, { x: 0.7, y: 1.5, w: 11.9, h: 5.5, fontSize: 18 });
    }
  }
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const { statSync } = await import('node:fs');
  mkdirSync(dirname(absPath), { recursive: true });
  await deck.writeFile({ fileName: absPath });
  return statSync(absPath).size;
}
