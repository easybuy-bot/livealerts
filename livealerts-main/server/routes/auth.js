import { Router } from 'express';
import { get, run } from '../db.js';
import { uid, nowIso, asyncHandler, ok, fail } from '../util.js';
import { config } from '../config.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, requireAuth,
} from '../middleware/auth.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

authRouter.post('/register', asyncHandler(async (req, res) => {
  const { email, password, name } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();

  if (!EMAIL_RE.test(cleanEmail)) return fail(res, 'Enter a valid email address', 400);
  if (String(password || '').length < 8) return fail(res, 'Password must be at least 8 characters', 400);
  if (!cleanName) return fail(res, 'Enter your name', 400);

  const existing = get('SELECT id FROM users WHERE email = ?', cleanEmail);
  if (existing) return fail(res, 'An account with this email already exists', 409);

  const id = uid('usr');
  const hash = hashPassword(password);
  const isAdmin = config.adminEmails.includes(cleanEmail) ? 1 : 0;
  run('INSERT INTO users (id, email, password_hash, name, is_admin, created_at) VALUES (?,?,?,?,?,?)',
    id, cleanEmail, hash, cleanName, isAdmin, nowIso());

  const user = get('SELECT id, email, name, plan, is_admin, created_at FROM users WHERE id = ?', id);
  const session = createSession(id, req);
  setSessionCookie(res, session.token, session.expiresAt);
  return ok(res, { user });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = get('SELECT * FROM users WHERE email = ?', cleanEmail);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return fail(res, 'Invalid email or password', 401);
  }
  // Keep admin grants in sync with ADMIN_EMAILS so an existing account can be promoted.
  const shouldBeAdmin = config.adminEmails.includes(cleanEmail) ? 1 : 0;
  if (shouldBeAdmin !== (user.is_admin ? 1 : 0)) {
    run('UPDATE users SET is_admin = ? WHERE id = ?', shouldBeAdmin, user.id);
    user.is_admin = shouldBeAdmin;
  }
  const session = createSession(user.id, req);
  setSessionCookie(res, session.token, session.expiresAt);
  return ok(res, { user: { id: user.id, email: user.email, name: user.name, plan: user.plan, is_admin: user.is_admin, created_at: user.created_at } });
}));

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.la_session;
  if (token) destroySession(token);
  clearSessionCookie(res);
  return ok(res);
});

authRouter.get('/me', requireAuth, (req, res) => ok(res, { user: req.user }));


authRouter.get('/sso', asyncHandler(async (req, res) => {
  const raw = String(req.query.token || '');
  const [body, sig] = raw.split('.');
  const crypto = await import('node:crypto');
  const expected = crypto.createHmac('sha256', config.appSecret).update(body || '').digest('hex');
  if (!body || !sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return fail(res, 'Invalid SSO token', 401);
  const payload = JSON.parse(Buffer.from(body.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
  if (!payload.exp || payload.exp * 1000 < Date.now()) return fail(res, 'SSO token expired', 401);
  let user = get('SELECT id, email, name, role FROM users WHERE id = ?', payload.uid);
  if (!user) return fail(res, 'Main website user not found', 401);
  const session = createSession(payload.uid, req);
  setSessionCookie(res, session.token, session.expiresAt);
  res.redirect('/dashboard.html');
}));
