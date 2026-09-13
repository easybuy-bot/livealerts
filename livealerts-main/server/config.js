import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function int(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function bool(v, d = false) { return v === undefined ? d : String(v).toLowerCase() === 'true' || v === '1'; }

const env = process.env;

// Platforms like Railway / Render inject the public domain at runtime. Deriving
// SITE_URL from it means the OBS Browser Source URLs and the OAuth redirect are
// correct on first boot, without hand-copying the generated domain.
const publicDomain = env.RAILWAY_PUBLIC_DOMAIN || env.RENDER_EXTERNAL_HOSTNAME || '';
const siteUrl = (env.SITE_URL
  || (publicDomain ? `https://${publicDomain}` : `http://localhost:${int(env.PORT, 3000)}`)
).replace(/\/+$/, '');

export const config = {
  root,
  port: int(env.PORT, 3000),
  host: env.HOST || '0.0.0.0',
  siteUrl,
  appSecret: env.APP_SECRET || 'dev-secret-change-me-in-production-please',
  isProd: env.NODE_ENV === 'production',
  cookieName: 'la_session',
  // Comma-separated emails granted admin access (used by /api/admin/*).
  adminEmails: String(env.ADMIN_EMAILS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  sessionDays: int(env.SESSION_DAYS, 30),

  dbPath: env.DB_PATH || path.join(root, 'data', 'livealerts.db'),
  uploadsDir: env.UPLOADS_DIR || path.join(root, 'data', 'uploads'),
  maxUploadMb: int(env.MAX_UPLOAD_MB, 50),

  // Google / YouTube OAuth
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: env.GOOGLE_REDIRECT_URI || `${siteUrl}/api/youtube/callback`,
  youtubeScopes: [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl',
  ],

  // Polling / quota strategy (LIVE DISCOVERY separated from EVENT PROCESSING)
  liveCheckIntervalMs: int(env.LIVE_CHECK_INTERVAL_MS, 120000),      // offline discovery: 2 min
  liveCheckJitterMs: int(env.LIVE_CHECK_JITTER_MS, 15000),
  chatPollIntervalMs: int(env.CHAT_POLL_INTERVAL_MS, 4000),          // live chat events
  chatPollJitterMs: int(env.CHAT_POLL_JITTER_MS, 800),
  subscriberPollIntervalMs: int(env.SUBSCRIBER_POLL_INTERVAL_MS, 300000), // 5 min
  pollerMaxErrors: int(env.POLLER_MAX_ERRORS, 6),

  // Alert engine
  maxQueuePerOverlay: int(env.MAX_QUEUE_PER_OVERLAY, 50),
  defaultAlertDurationMs: int(env.DEFAULT_ALERT_DURATION_MS, 6000),
};
