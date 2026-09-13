import { Router } from 'express';
import { get } from '../db.js';
import { asyncHandler, ok, fail, uid, nowIso } from '../util.js';
import { requireAuth } from '../middleware/auth.js';
import {
  listUserTemplates, getUserTemplate, createUserTemplate, updateUserTemplate,
  deleteUserTemplate, duplicateUserTemplate,
} from '../services/templateLibrary.js';
import { handleTestEvent } from '../services/alertEngine.js';
import { EVENT_TYPES } from '../services/normalizer.js';

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

alertsRouter.get('/', asyncHandler(async (req, res) => {
  return ok(res, { templates: listUserTemplates(req.user.id) });
}));

alertsRouter.post('/', asyncHandler(async (req, res) => {
  const { name, eventType, configuration } = req.body || {};
  if (!name) return fail(res, 'Name is required', 400);
  if (!EVENT_TYPES.includes(eventType)) return fail(res, 'Invalid event type', 400);
  const t = createUserTemplate(req.user.id, { name, eventType, configuration: configuration || {} });
  return ok(res, { template: t }, 201);
}));

alertsRouter.get('/:id', asyncHandler(async (req, res) => {
  const t = getUserTemplate(req.user.id, req.params.id);
  if (!t) return fail(res, 'Template not found', 404);
  return ok(res, { template: t });
}));

alertsRouter.put('/:id', asyncHandler(async (req, res) => {
  try {
    const t = updateUserTemplate(req.user.id, req.params.id, {
      name: req.body?.name,
      configuration: req.body?.configuration,
    });
    return ok(res, { template: t });
  } catch (e) {
    return fail(res, e.message, 404);
  }
}));

alertsRouter.delete('/:id', asyncHandler(async (req, res) => {
  try {
    deleteUserTemplate(req.user.id, req.params.id);
    return ok(res);
  } catch (e) {
    return fail(res, e.message, 404);
  }
}));

alertsRouter.post('/:id/duplicate', asyncHandler(async (req, res) => {
  try {
    const t = duplicateUserTemplate(req.user.id, req.params.id, req.body?.name);
    return ok(res, { template: t }, 201);
  } catch (e) {
    return fail(res, e.message, 404);
  }
}));

// Test mode: run a synthetic event through the SAME alert engine as production.
alertsRouter.post('/:id/test', asyncHandler(async (req, res) => {
  const tpl = getUserTemplate(req.user.id, req.params.id);
  if (!tpl) return fail(res, 'Template not found', 404);

  const { overlayId, username, amount, currency, message } = req.body || {};
  const overlay = overlayId
    ? get('SELECT * FROM overlays WHERE id = ? AND user_id = ?', overlayId, req.user.id)
    : get('SELECT * FROM overlays WHERE user_id = ? ORDER BY created_at ASC LIMIT 1', req.user.id);
  if (!overlay) return fail(res, 'Create an overlay first', 400);

  const event = {
    id: uid('evt'),
    type: tpl.eventType,
    username: username || 'TestUser',
    amount: amount != null ? Number(amount) : (tpl.eventType === 'SUPER_CHAT' || tpl.eventType === 'SUPER_STICKER' ? 250 : null),
    currency: currency || 'INR',
    message: message || 'This is a test alert!',
    profilePicture: '',
    channelName: 'Your Channel',
    streamTitle: 'Test Stream',
    subscriberCount: 1000,
    timestamp: nowIso(),
  };

  handleTestEvent({ userId: req.user.id, overlayId: overlay.id, event });
  return ok(res, { sent: true, overlayId: overlay.id, eventType: tpl.eventType });
}));
