import { Router } from 'express';
import { all } from '../db.js';
import { asyncHandler, ok, fail } from '../util.js';
import { requireAuth } from '../middleware/auth.js';
import {
  listTemplates, getTemplate, cloneTemplateForUser,
  addFavorite, removeFavorite, listFavorites, listRecentlyUsed,
} from '../services/templateLibrary.js';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

templatesRouter.get('/categories', asyncHandler(async (_req, res) => {
  const rows = all('SELECT DISTINCT category FROM templates WHERE status = ? ORDER BY category', 'active');
  return ok(res, { categories: rows.map((r) => r.category).filter(Boolean) });
}));

templatesRouter.get('/favorites', asyncHandler(async (req, res) => {
  return ok(res, { templates: listFavorites(req.user.id) });
}));

templatesRouter.get('/recent', asyncHandler(async (req, res) => {
  return ok(res, { templates: listRecentlyUsed(req.user.id) });
}));

templatesRouter.get('/', asyncHandler(async (req, res) => {
  const { eventType, category, search, orientation, premium, sort } = req.query;
  const templates = listTemplates({
    eventType, category, search, orientation, premium, sort,
    userId: req.user.id,
  });
  return ok(res, { templates });
}));

templatesRouter.get('/:id', asyncHandler(async (req, res) => {
  const t = getTemplate(req.params.id);
  if (!t) return fail(res, 'Template not found', 404);
  return ok(res, { template: t });
}));

// "Use Template" -> clone into the user's own templates (master stays immutable).
templatesRouter.post('/:id/use', asyncHandler(async (req, res) => {
  try {
    const name = req.body?.name || undefined;
    const cloned = cloneTemplateForUser(req.user.id, req.params.id, name);
    return ok(res, { template: cloned });
  } catch (e) {
    return fail(res, e.message, 404);
  }
}));

templatesRouter.post('/:id/favorite', asyncHandler(async (req, res) => {
  try {
    addFavorite(req.user.id, req.params.id);
    return ok(res);
  } catch (e) {
    return fail(res, e.message, 404);
  }
}));

templatesRouter.delete('/:id/favorite', asyncHandler(async (req, res) => {
  removeFavorite(req.user.id, req.params.id);
  return ok(res);
}));
