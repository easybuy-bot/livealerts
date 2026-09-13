import { all, get, run } from '../db.js';
import { uid, nowIso, safeJsonParse } from '../util.js';

export function templateToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    eventType: row.event_type,
    category: row.category,
    style: row.style,
    orientation: row.orientation,
    tags: safeJsonParse(row.tags, []),
    configuration: safeJsonParse(row.configuration, {}),
    isSystem: !!row.is_system,
    isPremium: !!row.is_premium,
    version: row.version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function userTemplateToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    sourceTemplateId: row.source_template_id,
    name: row.name,
    eventType: row.event_type,
    configuration: safeJsonParse(row.configuration, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List system templates with optional filters: eventType, category, search,
 * orientation, premium, sort (popular|recent), favoritesOnly (for a user).
 */
export function listTemplates({ eventType, category, search, orientation, premium, sort, userId } = {}) {
  const where = ['status = ?'];
  const params = ['active'];
  if (eventType && eventType !== 'All') { where.push('event_type = ?'); params.push(eventType); }
  if (category && category !== 'All') { where.push('category = ?'); params.push(category); }
  if (orientation && orientation !== 'All') { where.push('orientation = ?'); params.push(orientation); }
  if (premium === 'free') { where.push('is_premium = 0'); }
  if (premium === 'premium') { where.push('is_premium = 1'); }
  if (search) {
    where.push('(name LIKE ? OR description LIKE ? OR tags LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  let order = 'sort_order ASC, name ASC';
  if (sort === 'popular') {
    order = '(SELECT COUNT(*) FROM template_usage tu WHERE tu.template_id = templates.id) DESC, sort_order ASC';
  } else if (sort === 'recent') {
    order = 'created_at DESC';
  }

  const rows = all(`SELECT * FROM templates WHERE ${where.join(' AND ')} ORDER BY ${order}`, ...params);
  const favs = userId
    ? new Set(all('SELECT template_id FROM favorites WHERE user_id = ?', userId).map((r) => r.template_id))
    : new Set();
  return rows.map((r) => ({ ...templateToPublic(r), isFavorite: favs.has(r.id) }));
}

export function getTemplate(id) {
  return templateToPublic(get('SELECT * FROM templates WHERE id = ?', id));
}

/** Clone a system template into the user's own templates (never mutate the master). */
export function cloneTemplateForUser(userId, templateId, nameOverride) {
  const src = get('SELECT * FROM templates WHERE id = ? AND is_system = 1', templateId);
  if (!src) throw new Error('Template not found');
  const id = uid('ut');
  const name = nameOverride || src.name;
  run(
    `INSERT INTO user_templates (id, user_id, source_template_id, name, event_type, configuration, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    id, userId, src.id, name, src.event_type, src.configuration, nowIso(), nowIso()
  );
  recordUsage(userId, src.id);
  return userTemplateToPublic(get('SELECT * FROM user_templates WHERE id = ?', id));
}

export function listUserTemplates(userId) {
  return all('SELECT * FROM user_templates WHERE user_id = ? ORDER BY created_at DESC', userId)
    .map(userTemplateToPublic);
}

export function getUserTemplate(userId, id) {
  return userTemplateToPublic(get('SELECT * FROM user_templates WHERE id = ? AND user_id = ?', id, userId));
}

export function createUserTemplate(userId, { name, eventType, configuration, sourceTemplateId = null }) {
  const id = uid('ut');
  run(
    `INSERT INTO user_templates (id, user_id, source_template_id, name, event_type, configuration, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    id, userId, sourceTemplateId, name, eventType, JSON.stringify(configuration || {}), nowIso(), nowIso()
  );
  return userTemplateToPublic(get('SELECT * FROM user_templates WHERE id = ?', id));
}

export function updateUserTemplate(userId, id, { name, configuration }) {
  const existing = get('SELECT * FROM user_templates WHERE id = ? AND user_id = ?', id, userId);
  if (!existing) throw new Error('Template not found');
  run(
    'UPDATE user_templates SET name = ?, configuration = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    name ?? existing.name,
    configuration != null ? JSON.stringify(configuration) : existing.configuration,
    nowIso(), id, userId
  );
  return userTemplateToPublic(get('SELECT * FROM user_templates WHERE id = ?', id));
}

export function deleteUserTemplate(userId, id) {
  const existing = get('SELECT * FROM user_templates WHERE id = ? AND user_id = ?', id, userId);
  if (!existing) throw new Error('Template not found');
  run('DELETE FROM alert_assignments WHERE user_template_id = ? AND user_id = ?', id, userId);
  run('DELETE FROM user_templates WHERE id = ? AND user_id = ?', id, userId);
  return true;
}

export function duplicateUserTemplate(userId, id, nameOverride) {
  const existing = get('SELECT * FROM user_templates WHERE id = ? AND user_id = ?', id, userId);
  if (!existing) throw new Error('Template not found');
  return createUserTemplate(userId, {
    name: nameOverride || `${existing.name} — Copy`,
    eventType: existing.event_type,
    configuration: safeJsonParse(existing.configuration, {}),
    sourceTemplateId: existing.source_template_id,
  });
}

// --- favorites -------------------------------------------------------------
export function addFavorite(userId, templateId) {
  const t = get('SELECT id FROM templates WHERE id = ?', templateId);
  if (!t) throw new Error('Template not found');
  run('INSERT OR IGNORE INTO favorites (user_id, template_id, created_at) VALUES (?,?,?)', userId, templateId, nowIso());
  return true;
}

export function removeFavorite(userId, templateId) {
  run('DELETE FROM favorites WHERE user_id = ? AND template_id = ?', userId, templateId);
  return true;
}

export function listFavorites(userId) {
  return all(
    `SELECT t.* FROM favorites f JOIN templates t ON t.id = f.template_id
     WHERE f.user_id = ? ORDER BY f.created_at DESC`, userId
  ).map(templateToPublic);
}

export function listRecentlyUsed(userId, limit = 12) {
  return all(
    `SELECT t.*, MAX(tu.used_at) AS last_used FROM template_usage tu
     JOIN templates t ON t.id = tu.template_id
     WHERE tu.user_id = ? GROUP BY t.id ORDER BY last_used DESC LIMIT ?`, userId, limit
  ).map(templateToPublic);
}

export function recordUsage(userId, templateId) {
  run('INSERT INTO template_usage (user_id, template_id, used_at) VALUES (?,?,?)', userId, templateId, nowIso());
}
