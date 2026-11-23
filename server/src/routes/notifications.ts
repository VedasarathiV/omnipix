import { Router } from 'express';
import type { Request, Response } from 'express';
import { listNotifications, markAllRead, markRead, unreadCount } from '../lib/notifications.js';

export const notificationsRouter = Router();

notificationsRouter.get('/', (req: Request, res: Response) => {
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  res.json({ notifications: listNotifications(unreadOnly), unread: unreadCount() });
});

notificationsRouter.post('/:id/read', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid notification ID' } });
    return;
  }
  if (!markRead(id)) {
    res.status(404).json({ error: { message: 'Notification not found' } });
    return;
  }
  res.json({ read: id, unread: unreadCount() });
});

notificationsRouter.post('/read-all', (_req: Request, res: Response) => {
  res.json({ read: markAllRead(), unread: 0 });
});
