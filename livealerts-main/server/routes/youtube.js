import { Router } from 'express';
import { get, run } from '../db.js';
import { uid, nowIso, asyncHandler, ok, fail, randomToken } from '../util.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { encryptSecret } from '../crypto.js';
import { getAuthUrl, exchangeCode, getChannelInfo } from '../services/youtubeClient.js';
import { publicConnection } from '../services/connectionView.js';
import { startConnection, stopConnection, refreshConnection } from '../services/pipeline.js';

export const youtubeRouter = Router();

youtubeRouter.use(requireAuth);

youtubeRouter.get('/auth-url', asyncHandler(async (req, res) => {
  if (!config.googleClientId || !config.googleClientSecret) {
    return fail(res, 'YouTube OAuth is not configured on the server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.', 503);
  }
  const state = randomToken(24);
  run('INSERT INTO oauth_states (state, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    state, req.user.id, nowIso(), new Date(Date.now() + 10 * 60000).toISOString());
  return ok(res, { url: getAuthUrl(state) });
}));

// OAuth redirect target (browser navigates here from Google).
youtubeRouter.get('/callback', asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  const failRedirect = (msg) => res.redirect(`${config.siteUrl}/dashboard.html?connected=error&reason=${encodeURIComponent(msg)}`);

  if (error) return failRedirect(String(error));
  if (!code || !state) return failRedirect('Missing OAuth parameters');

  const st = get('SELECT * FROM oauth_states WHERE state = ?', state);
  if (!st || new Date(st.expires_at).getTime() < Date.now()) return failRedirect('OAuth state expired');
  run('DELETE FROM oauth_states WHERE state = ?', state);

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (e) {
    return failRedirect('Token exchange failed');
  }
  if (!tokens.refresh_token) {
    // Re-auth needed to obtain a refresh token (user previously consented).
    return failRedirect('No refresh token returned — please disconnect and reconnect');
  }

  // Read channel info using the fresh tokens.
  const tempConn = {
    id: uid('tmp'),
    access_token_enc: encryptSecret(tokens.access_token),
    refresh_token_enc: encryptSecret(tokens.refresh_token),
    token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
  };
  let channel;
  try {
    channel = await getChannelInfo(tempConn);
  } catch (e) {
    return failRedirect('Could not read channel info');
  }
  if (!channel) return failRedirect('No YouTube channel found on this Google account');

  // One connection per user: upsert.
  const existing = get('SELECT * FROM youtube_connections WHERE user_id = ?', st.user_id);
  if (existing) {
    stopConnection(existing.id);
    run(
      `UPDATE youtube_connections SET channel_id=?, channel_title=?, channel_thumbnail=?, subscriber_count=?,
       access_token_enc=?, refresh_token_enc=?, token_expires_at=?, scopes=?, state='OFFLINE',
       live_video_id=NULL, live_chat_id=NULL, live_title=NULL, last_error=NULL, updated_at=?
       WHERE id=?`,
      channel.channelId, channel.title, channel.thumbnail, channel.subscriberCount,
      encryptSecret(tokens.access_token), encryptSecret(tokens.refresh_token),
      tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      JSON.stringify(tokens.scope || config.youtubeScopes), nowIso(), existing.id
    );
    startConnection(existing.id);
  } else {
    const id = uid('conn');
    run(
      `INSERT INTO youtube_connections (id, user_id, channel_id, channel_title, channel_thumbnail, subscriber_count,
       access_token_enc, refresh_token_enc, token_expires_at, scopes, state, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, st.user_id, channel.channelId, channel.title, channel.thumbnail, channel.subscriberCount,
      encryptSecret(tokens.access_token), encryptSecret(tokens.refresh_token),
      tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      JSON.stringify(tokens.scope || config.youtubeScopes), 'OFFLINE', nowIso(), nowIso()
    );
    startConnection(id);
  }

  return res.redirect(`${config.siteUrl}/dashboard.html?connected=1`);
}));

youtubeRouter.get('/connection', asyncHandler(async (req, res) => {
  const conn = get('SELECT * FROM youtube_connections WHERE user_id = ?', req.user.id);
  return ok(res, { connection: publicConnection(conn) });
}));

youtubeRouter.post('/refresh', asyncHandler(async (req, res) => {
  const conn = get('SELECT * FROM youtube_connections WHERE user_id = ?', req.user.id);
  if (!conn) return fail(res, 'No YouTube connection', 404);
  refreshConnection(conn.id);
  return ok(res, { connection: publicConnection(get('SELECT * FROM youtube_connections WHERE id = ?', conn.id)) });
}));

youtubeRouter.delete('/connection', asyncHandler(async (req, res) => {
  const conn = get('SELECT * FROM youtube_connections WHERE user_id = ?', req.user.id);
  if (!conn) return fail(res, 'No YouTube connection', 404);
  stopConnection(conn.id);
  run('DELETE FROM youtube_connections WHERE id = ? AND user_id = ?', conn.id, req.user.id);
  return ok(res);
}));
