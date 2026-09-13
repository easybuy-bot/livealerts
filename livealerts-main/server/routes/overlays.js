import { Router } from 'express';
import { get, all, run } from '../db.js';
import { asyncHandler, ok, fail, uid, nowIso, randomToken, safeJsonParse } from '../util.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { createDefaultAssignments } from '../services/defaults.js';

export const overlaysRouter = Router();
overlaysRouter.use(requireAuth);

function overlayToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    token: row.token,
    width: row.width,
    height: row.height,
    orientation: row.orientation,
    settings: safeJsonParse(row.settings, {}),
    browserSourceUrl: `${config.siteUrl}/overlay/${row.token}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

overlaysRouter.get('/', asyncHandler(async (req, res) => {
  const rows = all('SELECT * FROM overlays WHERE user_id = ? ORDER BY created_at ASC', req.user.id);
  return ok(res, { overlays: rows.map(overlayToPublic) });
}));

overlaysRouter.post('/', asyncHandler(async (req, res) => {
  const { name, width, height, orientation } = req.body || {};
  if (!name) return fail(res, 'Name is required', 400);
  const id = uid('ovl');
  const token = randomToken(24);
  run(
    `INSERT INTO overlays (id, user_id, name, token, width, height, orientation, settings, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, req.user.id, name, token,
    Number(width) || 1920, Number(height) || 1080,
    orientation || '16:9', '{}', nowIso(), nowIso()
  );
  createDefaultAssignments(req.user.id, id);
  return ok(res, { overlay: overlayToPublic(get('SELECT * FROM overlays WHERE id = ?', id)) }, 201);
}));

overlaysRouter.get('/:id', asyncHandler(async (req, res) => {
  const row = get('SELECT * FROM overlays WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!row) return fail(res, 'Overlay not found', 404);
  return ok(res, { overlay: overlayToPublic(row) });
}));

overlaysRouter.put('/:id', asyncHandler(async (req, res) => {
  const row = get('SELECT * FROM overlays WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!row) return fail(res, 'Overlay not found', 404);
  const { name, width, height, orientation, settings } = req.body || {};
  run(
    `UPDATE overlays SET name=?, width=?, height=?, orientation=?, settings=?, updated_at=? WHERE id=? AND user_id=?`,
    name ?? row.name,
    Number(width) || row.width,
    Number(height) || row.height,
    orientation ?? row.orientation,
    settings != null ? JSON.stringify(settings) : row.settings,
    nowIso(), req.params.id, req.user.id
  );
  return ok(res, { overlay: overlayToPublic(get('SELECT * FROM overlays WHERE id = ?', req.params.id)) });
}));

overlaysRouter.delete('/:id', asyncHandler(async (req, res) => {
  const row = get('SELECT * FROM overlays WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!row) return fail(res, 'Overlay not found', 404);
  run('DELETE FROM alert_assignments WHERE overlay_id = ? AND user_id = ?', req.params.id, req.user.id);
  run('DELETE FROM overlays WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  return ok(res);
}));

overlaysRouter.post('/:id/regenerate-token', asyncHandler(async (req, res) => {
  const row = get('SELECT * FROM overlays WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!row) return fail(res, 'Overlay not found', 404);
  const token = randomToken(24);
  run('UPDATE overlays SET token = ?, updated_at = ? WHERE id = ? AND user_id = ?', token, nowIso(), req.params.id, req.user.id);
  return ok(res, { overlay: overlayToPublic(get('SELECT * FROM overlays WHERE id = ?', req.params.id)) });
}));

overlaysRouter.get('/:id/assignments', asyncHandler(async (req, res) => {
  const row = get('SELECT * FROM overlays WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!row) return fail(res, 'Overlay not found', 404);
  const rows = all(
    `SELECT a.*, ut.name AS template_name FROM alert_assignments a
     JOIN user_templates ut ON ut.id = a.user_template_id
     WHERE a.overlay_id = ? AND a.user_id = ? ORDER BY a.event_type`, req.params.id, req.user.id
  );
  return ok(res, {
    assignments: rows.map((a) => ({
      id: a.id, eventType: a.event_type, userTemplateId: a.user_template_id,
      templateName: a.template_name, priority: a.priority,
      conditions: safeJsonParse(a.conditions, {}), enabled: !!a.enabled,
    })),
  });
}));

// Replace assignments for one event type on this overlay.
overlaysRouter.put('/:id/assignments', asyncHandler(async (req, res) => {
  const row = get('SELECT * FROM overlays WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!row) return fail(res, 'Overlay not found', 404);

  const items = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  run('DELETE FROM alert_assignments WHERE overlay_id = ? AND user_id = ?', req.params.id, req.user.id);
  for (const a of items) {
    const tpl = get('SELECT id FROM user_templates WHERE id = ? AND user_id = ?', a.userTemplateId, req.user.id);
    if (!tpl) continue;
    run(
      `INSERT INTO alert_assignments (id, user_id, overlay_id, event_type, user_template_id, priority, conditions, enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      uid('asg'), req.user.id, req.params.id, a.eventType, a.userTemplateId,
      Number(a.priority) || 1, JSON.stringify(a.conditions || {}), a.enabled === false ? 0 : 1, nowIso(), nowIso()
    );
  }
  return ok(res);
}));
