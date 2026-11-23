import { Router } from 'express';
import type { Request, Response } from 'express';
import { collectDiagnosticsBundle } from '../services/diagnostics.js';

// Support bundle: one JSON document with everything a bug report needs.
// Mounted behind requireAuth like every admin route — it names providers,
// models, and failure reasons, but never key material (see diagnostics.ts).
export const diagnosticsRouter = Router();

diagnosticsRouter.get('/bundle', (_req: Request, res: Response) => {
  res.json(collectDiagnosticsBundle());
});
