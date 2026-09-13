import crypto from 'node:crypto';

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function nowIso() {
  return new Date().toISOString();
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function json(res, data, status = 200) {
  return res.status(status).json(data);
}

export function ok(res, data = {}, status = 200) {
  return json(res, { ok: true, ...data }, status);
}

export function fail(res, message, status = 400, extra = {}) {
  return json(res, { ok: false, error: message, ...extra }, status);
}

export function safeJsonParse(str, fallback = null) {
  if (str == null) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 120);
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
