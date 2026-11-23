import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getScan,
  getScanSettings,
  listFindings,
  listScans,
  runSecurityScan,
  updateScanSettings,
} from '../services/security-scans.js';

export const securityScansRouter = Router();

securityScansRouter.get('/scans', (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  res.json({ scans: listScans(limit), settings: getScanSettings() });
});

securityScansRouter.post('/scans', (_req: Request, res: Response) => {
  const scan = runSecurityScan('manual');
  res.status(201).json({ scan, findings: listFindings(scan.id) });
});

securityScansRouter.get('/scans/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid scan ID' } });
    return;
  }
  const scan = getScan(id);
  if (!scan) {
    res.status(404).json({ error: { message: 'Scan not found' } });
    return;
  }
  res.json({ scan, findings: listFindings(id) });
});

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  schedule: z.string().trim().min(1).max(60).optional(),
});

securityScansRouter.patch('/scans-settings', (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(e => e.message).join(', ') } });
    return;
  }
  try {
    res.json({ settings: updateScanSettings(parsed.data) });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : String(err) } });
  }
});
