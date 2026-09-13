import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run } from '../db.js';
import { asyncHandler, ok, fail, uid, nowIso, sanitizeFilename } from '../util.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

export const mediaRouter = Router();
mediaRouter.use(requireAuth);

const KINDS = new Set(['image', 'gif', 'video', 'sound', 'background']);

function storageFor(userId) {
  const dir = path.join(config.uploadsDir, userId);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const rawExt = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
      // Sanitize the extension too: it ends up on disk and in a public URL.
      const ext = rawExt ? '.' + sanitizeFilename(rawExt.slice(1)).replace(/^\.+/, '') : '';
      cb(null, `${uid('m')}${ext}`);
    },
  });
}

function uploader(userId) {
  return multer({
    storage: storageFor(userId),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  }).single('file');
}

function mediaToPublic(row) {
  return {
    id: row.id, userId: row.user_id, kind: row.kind, filename: row.filename,
    mime: row.mime, size: row.size, url: row.url, createdAt: row.created_at,
  };
}

mediaRouter.get('/', asyncHandler(async (req, res) => {
  const kind = req.query.kind;
  const rows = kind
    ? all('SELECT * FROM media WHERE user_id = ? AND kind = ? ORDER BY created_at DESC', req.user.id, kind)
    : all('SELECT * FROM media WHERE user_id = ? ORDER BY created_at DESC', req.user.id);
  // `limits` lets the UI show the real max upload size instead of a guess.
  return ok(res, { media: rows.map(mediaToPublic), limits: { maxUploadMb: config.maxUploadMb, kinds: [...KINDS] } });
}));

mediaRouter.post('/', asyncHandler(async (req, res) => {
  // multer must run first: with multipart/form-data req.body is empty until it parses,
  // so reading `kind` before this point always fell back to 'image'.
  await new Promise((resolve, reject) => {
    uploader(req.user.id)(req, res, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  if (!req.file) return fail(res, 'No file uploaded', 400);

  const kind = req.body?.kind || 'image';
  if (!KINDS.has(kind)) {
    try { fs.unlinkSync(req.file.path); } catch { /* nothing to clean up */ }
    return fail(res, 'Invalid media kind', 400);
  }

  const id = uid('med');
  const url = `/uploads/${req.user.id}/${req.file.filename}`;
  run(
    `INSERT INTO media (id, user_id, kind, filename, mime, size, path, url, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, req.user.id, kind, sanitizeFilename(req.file.originalname),
    req.file.mimetype, req.file.size, req.file.path, url, nowIso()
  );
  return ok(res, { media: mediaToPublic(get('SELECT * FROM media WHERE id = ?', id)) }, 201);
}));

mediaRouter.delete('/:id', asyncHandler(async (req, res) => {
  const row = get('SELECT * FROM media WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!row) return fail(res, 'Media not found', 404);
  try { fs.unlinkSync(row.path); } catch { /* already gone */ }
  run('DELETE FROM media WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  return ok(res);
}));
