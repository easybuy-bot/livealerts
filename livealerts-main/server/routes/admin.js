import { Router } from 'express';
import { get } from '../db.js';
import { asyncHandler, ok } from '../util.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/stats', asyncHandler(async (_req, res) => {
  const users = get('SELECT COUNT(*) AS c FROM users').c;
  const connections = get('SELECT COUNT(*) AS c FROM youtube_connections').c;
  const overlays = get('SELECT COUNT(*) AS c FROM overlays').c;
  const events = get('SELECT COUNT(*) AS c FROM events').c;
  const templates = get('SELECT COUNT(*) AS c FROM templates WHERE is_system = 1').c;
  return ok(res, { stats: { users, connections, overlays, events, templates } });
}));
