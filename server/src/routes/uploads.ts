import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PDFParse } from 'pdf-parse';

export const uploadsRouter = Router();

// Chat attachment helpers. PDF text extraction runs server-side so the
// browser/Electron client needs no PDF engine; extracted text flows
// through the same inline-and-truncate path as text files.

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 500 * 1024;

const parsePdfSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  dataBase64: z.string().min(1).max(MAX_PDF_BYTES * 2),
});

uploadsRouter.post('/parse-pdf', async (req: Request, res: Response) => {
  const parsed = parsePdfSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  if (!parsed.data.filename.toLowerCase().endsWith('.pdf')) {
    res.status(400).json({ error: { message: 'Only .pdf files parse here' } });
    return;
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(parsed.data.dataBase64, 'base64');
  } catch {
    res.status(400).json({ error: { message: 'Invalid base64 payload' } });
    return;
  }
  if (buffer.length > MAX_PDF_BYTES || buffer.length === 0) {
    res.status(400).json({ error: { message: 'PDF must be 1 byte to 5MB' } });
    return;
  }
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    res.status(400).json({ error: { message: 'Not a PDF file' } });
    return;
  }
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = (result.text ?? '').replace(/\s+$/u, '');
    if (!text.trim()) {
      res.status(400).json({ error: { message: 'No extractable text in this PDF (scanned images need OCR)' } });
      return;
    }
    const truncated = text.length > MAX_TEXT_CHARS;
    res.json({
      text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
      truncated,
      pages: typeof result.total === 'number' ? result.total : undefined,
    });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? `PDF parse failed: ${err.message}`.slice(0, 200) : 'PDF parse failed' } });
  } finally {
    await parser.destroy().catch(() => {});
  }
});
