import { google } from 'googleapis';
import { config } from '../config.js';
import { encryptSecret, decryptSecret } from '../crypto.js';
import { run } from '../db.js';

export function createOAuth() {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );
}

export function getAuthUrl(state) {
  const oauth = createOAuth();
  return oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: config.youtubeScopes,
    state,
  });
}

export async function exchangeCode(code) {
  const oauth = createOAuth();
  const { tokens } = await oauth.getToken(code);
  return tokens; // access_token, refresh_token, expiry_date, scope
}

/**
 * Build an authenticated OAuth2 client for a stored connection.
 * Persists refreshed tokens back to the database automatically.
 */
export function clientForConnection(conn) {
  const oauth = createOAuth();
  oauth.setCredentials({
    access_token: decryptSecret(conn.access_token_enc),
    refresh_token: decryptSecret(conn.refresh_token_enc),
    expiry_date: conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : undefined,
  });
  oauth.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      run('UPDATE youtube_connections SET refresh_token_enc = ? WHERE id = ?',
        encryptSecret(tokens.refresh_token), conn.id);
    }
    if (tokens.access_token) {
      run('UPDATE youtube_connections SET access_token_enc = ?, token_expires_at = ? WHERE id = ?',
        encryptSecret(tokens.access_token),
        tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        conn.id);
    }
  });
  return oauth;
}

function yt(conn) {
  return google.youtube({ version: 'v3', auth: clientForConnection(conn) });
}

/** channels.list with snippet, statistics, contentDetails for the authenticated user. */
export async function getChannelInfo(conn) {
  const res = await yt(conn).channels.list({ part: ['snippet', 'statistics', 'contentDetails'], mine: true });
  const item = res.data.items?.[0];
  if (!item) return null;
  return {
    channelId: item.id,
    title: item.snippet?.title || '',
    thumbnail: item.snippet?.thumbnails?.default?.url || item.snippet?.thumbnails?.medium?.url || '',
    subscriberCount: Number(item.statistics?.subscriberCount || 0),
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads || null,
  };
}

/** Latest video ids from the channel's uploads playlist (cheap: 1 unit). */
export async function getLatestVideoIds(conn, uploadsPlaylistId, max = 5) {
  const res = await yt(conn).playlistItems.list({
    part: ['contentDetails'],
    playlistId: uploadsPlaylistId,
    maxResults: max,
  });
  return (res.data.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
}

/** Video details including liveStreamingDetails (cheap: 1 unit). */
export async function getVideoDetails(conn, videoIds) {
  if (!videoIds.length) return [];
  const res = await yt(conn).videos.list({
    part: ['snippet', 'liveStreamingDetails', 'status'],
    id: videoIds.slice(0, 50),
  });
  return res.data.items || [];
}

/** Resolve the liveChatId for a live video. */
export async function getLiveChatId(conn, videoId) {
  const res = await yt(conn).videos.list({
    part: ['liveStreamingDetails'],
    id: [videoId],
  });
  return res.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId || null;
}

/** Poll live chat messages (1 unit per call). */
export async function pollLiveChat(conn, liveChatId, pageToken = null) {
  const params = {
    part: ['id', 'snippet', 'authorDetails'],
    liveChatId,
    maxResults: 200,
  };
  if (pageToken) params.pageToken = pageToken;
  const res = await yt(conn).liveChatMessages.list(params);
  return {
    items: res.data.items || [],
    nextPageToken: res.data.nextPageToken || null,
    pollingIntervalMillis: res.data.pollingIntervalMillis || 4000,
  };
}

/** Subscriber count only (1 unit). */
export async function getSubscriberCount(conn) {
  const res = await yt(conn).channels.list({ part: ['statistics'], mine: true });
  const item = res.data.items?.[0];
  return Number(item?.statistics?.subscriberCount || 0);
}

/** Persist refreshed token state after an API call. */
export function persistTokens(conn, tokens) {
  if (tokens?.access_token) {
    run('UPDATE youtube_connections SET access_token_enc = ?, token_expires_at = ? WHERE id = ?',
      encryptSecret(tokens.access_token),
      tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      conn.id);
  }
  if (tokens?.refresh_token) {
    run('UPDATE youtube_connections SET refresh_token_enc = ? WHERE id = ?',
      encryptSecret(tokens.refresh_token), conn.id);
  }
}

/**
 * True when the OAuth grant itself is no longer usable (revoked access, deleted
 * app, changed password). These are permanent until the user reconnects, so the
 * pipeline parks the connection in the ERROR state instead of retrying forever.
 */
export function isAuthError(err) {
  const code = err?.response?.status ?? err?.code;
  const reason = String(err?.response?.data?.error || err?.message || '');
  return code === 401 || code === 403 ||
    /invalid_grant|invalid_token|unauthorized|insufficient(Permissions|Scope)/i.test(reason);
}
