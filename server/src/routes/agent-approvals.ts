import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { decideApproval, getApproval, listApprovals } from '../lib/agent-policy.js';
import { getAgentRun } from '../services/agent-runtime.js';

export const agentApprovalsRouter = Router();

agentApprovalsRouter.get('/approvals', (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (status && !['pending', 'approved', 'denied', 'expired'].includes(status)) {
    res.status(400).json({ error: { message: 'Invalid status filter' } });
    return;
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  res.json({ approvals: listApprovals(status, limit) });
});

agentApprovalsRouter.get('/approvals/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid approval ID' } });
    return;
  }
  const approval = getApproval(id);
  if (!approval) {
    res.status(404).json({ error: { message: 'Approval not found' } });
    return;
  }
  res.json({ ...approval, args: JSON.parse(approval.args_json) });
});

const decideSchema = z.object({
  approved: z.boolean(),
});

agentApprovalsRouter.post('/approvals/:id/decide', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid approval ID' } });
    return;
  }
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: 'Send {"approved": true|false}' } });
    return;
  }
  try {
    const runId = decideApproval(id, parsed.data.approved);
    res.json({ approval: getApproval(id), run: getAgentRun(runId) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'Approval not found' ? 404 : message.startsWith('Approval already') ? 409 : 400;
    res.status(status).json({ error: { message } });
  }
});
