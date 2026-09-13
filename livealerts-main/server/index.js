import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { migrate, get } from './db.js';
import { initRealtime } from './services/realtime.js';
import { startAllConnections, stopAllConnections } from './services/pipeline.js';
import { seedTemplates } from './seeds/templates.js';

import { authRouter } from './routes/auth.js';
import { youtubeRouter } from './routes/youtube.js';
import { templatesRouter } from './routes/templates.js';
import { alertsRouter } from './routes/alerts.js';
import { overlaysRouter } from './routes/overlays.js';
import { mediaRouter } from './routes/media.js';
import { eventsRouter } from './routes/events.js';
import { adminRouter } from './routes/admin.js';

migrate();
seedTemplates();

const app = express();
app.disable('x-powered-by');
// Behind Railway/Render/Nginx the TLS terminates at the proxy, so Express must
// trust the X-Forwarded-* headers for req.protocol / req.ip to be truthful.
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Static assets + SPA pages
// Create the uploads dir up front: on a fresh container the mounted volume is
// empty, and express.static logs noisily when its root does not exist.
fs.mkdirSync(config.uploadsDir, { recursive: true });
app.use('/uploads', express.static(config.uploadsDir, { maxAge: '7d' }));

// API
app.use('/api/auth', authRouter);
app.use('/api/youtube', youtubeRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/my-templates', alertsRouter);
app.use('/api/overlays', overlaysRouter);
app.use('/api/media', mediaRouter);
app.use('/api/events', eventsRouter);
app.use('/api/admin', adminRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'LiveAlerts', time: new Date().toISOString() }));
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// Overlay static assets (renderer.js / renderer.css)
app.use('/overlay', express.static(path.join(config.root, 'overlay')));

// Overlay (OBS browser source) — token in the URL is the credential.
app.get('/overlay/:token', (req, res) => {
  const overlay = get('SELECT * FROM overlays WHERE token = ?', req.params.token);
  if (!overlay) return res.status(404).send('Overlay not found');
  res.sendFile(path.join(config.root, 'overlay', 'index.html'));
});

app.get('/overlay/:token/info', (req, res) => {
  const overlay = get('SELECT id, width, height, orientation, settings FROM overlays WHERE token = ?', req.params.token);
  if (!overlay) return res.status(404).json({ ok: false, error: 'Overlay not found' });
  res.json({ ok: true, overlay });
});

// SPA pages + static frontend assets
app.use(express.static(path.join(config.root, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(config.root, 'public', 'index.html')));

// 404 + error handler
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: 'File too large' });
  res.status(500).json({ ok: false, error: 'Server error' });
});

const server = http.createServer(app);
initRealtime(server);

export function start() {
  startAllConnections();
  return new Promise((resolve) => {
    server.listen(config.port, config.host, () => {
      console.log(`LiveAlerts running at ${config.siteUrl}`);
      console.log(`Database: ${config.dbPath}`);
      resolve(server);
    });
  });
}

export function stop() {
  stopAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

export { app, server };

// Auto-start when run directly (node server/index.js).
import { pathToFileURL } from 'node:url';
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  start();
  function shutdown() {
    stopAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
