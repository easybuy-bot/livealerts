import crypto from 'node:crypto';
import { config } from '../config.js';
import { get, run } from '../db.js';
import { randomToken, nowIso } from '../util.js';

// --- password hashing (scrypt, no external deps) --------------------------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch {
    return false;
  }
}

// --- sessions --------------------------------------------------------------
export function createSession(userId, req) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionDays * 86400000).toISOString();
  run(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)`,
    token, userId, nowIso(), expiresAt, req?.ip || null, req?.headers?.['user-agent'] || null
  );
  return { token, expiresAt };
}

export function destroySession(token) {
  run('DELETE FROM sessions WHERE token = ?', token);
}

export function sessionUser(token) {
  if (!token) return null;
  const s = get('SELECT * FROM sessions WHERE token = ?', token);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    run('DELETE FROM sessions WHERE token = ?', token);
    return null;
  }
  const u = get('SELECT id, email, name, plan, is_admin, created_at FROM users WHERE id = ?', s.user_id);
  return u || null;
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.cookieName, { path: '/' });
}

// --- middleware ------------------------------------------------------------
export function requireAuth(req, res, next) {
  const token = req.cookies?.[config.cookieName];
  const user = sessionUser(token);
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }
  req.user = user;
  req.sessionToken = token;
  next();
}

export function optionalAuth(req, _res, next) {
  const token = req.cookies?.[config.cookieName];
  req.user = sessionUser(token) || null;
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ ok: false, error: 'Admin only' });
  }
  next();
}

export function hasActiveYoutubeLicense(userId) {
  const row = get(`SELECT k.id FROM access_keys k JOIN products p ON p.id=k.product_id WHERE k.user_id=? AND p.kind='youtube_live' AND p.active=1 AND k.status='active' AND (k.expires_at IS NULL OR k.expires_at >= NOW()) LIMIT 1`, userId);
  return !!row;
}

export function requireYoutubeLicense(req, res, next) {
  if (!req.user?.id || !hasActiveYoutubeLicense(req.user.id)) {
    return res.status(403).json({ ok:false, error:'YouTube Live Alerts License Inactive' });
  }
  next();
}
