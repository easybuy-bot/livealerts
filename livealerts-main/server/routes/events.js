import { Router } from 'express';
import { all, get } from '../db.js';
import { asyncHandler, ok } from '../util.js';
import { requireAuth } from '../middleware/auth.js';
import { safeJsonParse } from '../util.js';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

eventsRouter.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const eventType = req.query.eventType;
  const rows = eventType
    ? all('SELECT * FROM events WHERE user_id = ? AND event_type = ? ORDER BY created_at DESC LIMIT ?', req.user.id, eventType, limit)
    : all('SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', req.user.id, limit);
  return ok(res, {
    events: rows.map((r) => ({
      id: r.id, eventType: r.event_type, username: r.username, amount: r.amount,
      currency: r.currency, message: r.message, payload: safeJsonParse(r.payload, {}),
      createdAt: r.created_at,
    })),
  });
}));

eventsRouter.get('/analytics', asyncHandler(async (req, res) => {
  const totals = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN event_type='SUBSCRIBER' THEN 1 ELSE 0 END) AS subscribers,
            SUM(CASE WHEN event_type='SUPER_CHAT' THEN 1 ELSE 0 END) AS super_chats,
            SUM(CASE WHEN event_type='SUPER_STICKER' THEN 1 ELSE 0 END) AS super_stickers,
            SUM(CASE WHEN event_type='NEW_MEMBER' THEN 1 ELSE 0 END) AS members,
            SUM(CASE WHEN event_type='GIFT_MEMBERSHIP' THEN 1 ELSE 0 END) AS gifts,
            SUM(CASE WHEN event_type IN ('SUPER_CHAT','SUPER_STICKER') THEN amount ELSE 0 END) AS revenue
     FROM events WHERE user_id = ?`, req.user.id
  );
  const top = all(
    `SELECT username, SUM(amount) AS total, COUNT(*) AS cnt FROM events
     WHERE user_id = ? AND amount IS NOT NULL AND username IS NOT NULL
     GROUP BY username ORDER BY total DESC LIMIT 5`, req.user.id
  );
  return ok(res, { analytics: { ...totals, topSupporters: top } });
}));
