import { all, get } from '../db.js';
import { config } from '../config.js';
import { checkLive, markLive, markOffline, markState } from './liveDetector.js';
import { pollChatOnce } from './chatPoller.js';
import { checkSubscribers } from './subscriberMonitor.js';
import { normalizeLiveStart, normalizeLiveEnd } from './normalizer.js';
import { handleEvent } from './alertEngine.js';
import { emitToUser } from './realtime.js';
import { publicConnection } from './connectionView.js';
import { isAuthError } from './youtubeClient.js';

const runtimes = new Map(); // connId -> runtime state

function reload(connId) {
  return get('SELECT * FROM youtube_connections WHERE id = ?', connId);
}

function runtimeFor(conn) {
  let rt = runtimes.get(conn.id);
  if (!rt) {
    rt = {
      connId: conn.id,
      liveChatId: conn.live_chat_id || null,
      pageToken: null,
      pollInterval: config.chatPollIntervalMs,
      seen: new Set(),
      lastSubscriberCount: conn.subscriber_count ?? null,
      liveTimer: null,
      chatTimer: null,
      subTimer: null,
      stopping: false,
      wasLive: conn.state === 'LIVE',
    };
    runtimes.set(conn.id, rt);
  }
  return rt;
}

function notify(connId) {
  const conn = reload(connId);
  if (conn) emitToUser(conn.user_id, 'connection:update', publicConnection(conn));
}

// --- LIVE DISCOVERY --------------------------------------------------------
function scheduleDiscovery(connId) {
  const rt = runtimes.get(connId);
  if (!rt || rt.stopping) return;
  clearTimeout(rt.liveTimer);
  const delay = config.liveCheckIntervalMs + Math.random() * config.liveCheckJitterMs;
  rt.liveTimer = setTimeout(() => discoveryTick(connId), delay);
}

async function discoveryTick(connId) {
  const rt = runtimes.get(connId);
  if (!rt || rt.stopping) return;
  const conn = reload(connId);
  if (!conn) return;

  markState(connId, 'DETECTING');
  try {
    const res = await checkLive(conn);
    if (res.live) {
      markLive(connId, res);
      rt.liveChatId = res.liveChatId;
      rt.wasLive = true;
      const fresh = reload(connId);
      handleEvent({
        userId: fresh.user_id,
        connectionId: connId,
        event: normalizeLiveStart({
          channelName: fresh.channel_title,
          streamTitle: res.title,
          videoId: res.videoId,
        }),
      });
      startChatPolling(connId);
      startSubscriberPolling(connId);
      clearTimeout(rt.liveTimer);
      rt.liveTimer = null;
    } else {
      if (rt.wasLive) {
        markOffline(connId);
        rt.wasLive = false;
        stopChatPolling(connId);
        stopSubscriberPolling(connId);
        const fresh = reload(connId);
        handleEvent({
          userId: fresh.user_id,
          connectionId: connId,
          event: normalizeLiveEnd({ channelName: fresh.channel_title }),
        });
      } else {
        markState(connId, 'OFFLINE');
      }
      scheduleDiscovery(connId);
    }
    notify(connId);
  } catch (err) {
    if (isAuthError(err)) {
      // Permanent: the YouTube grant is gone. Stop polling and wait for the
      // user to reconnect, so we don't burn quota on a dead connection.
      markState(connId, 'ERROR', 'YouTube access was revoked or expired. Please reconnect your channel.');
      stopChatPolling(connId);
      stopSubscriberPolling(connId);
      notify(connId);
      return;
    }
    markState(connId, 'RECONNECTING', String(err.message || err));
    notify(connId);
    scheduleDiscovery(connId);
  }
}

// --- LIVE EVENT PROCESSING -------------------------------------------------
function scheduleChat(connId) {
  const rt = runtimes.get(connId);
  if (!rt || rt.stopping) return;
  clearTimeout(rt.chatTimer);
  const delay = (rt.pollInterval || config.chatPollIntervalMs) + Math.random() * config.chatPollJitterMs;
  rt.chatTimer = setTimeout(() => chatTick(connId), delay);
}

async function chatTick(connId) {
  const rt = runtimes.get(connId);
  if (!rt || rt.stopping) return;
  const conn = reload(connId);
  if (!conn) return;

  if (!rt.liveChatId) {
    // No active chat — fall back to discovery (stream may have ended).
    stopChatPolling(connId);
    stopSubscriberPolling(connId);
    scheduleDiscovery(connId);
    return;
  }

  try {
    await pollChatOnce(conn, rt);
    scheduleChat(connId);
  } catch (err) {
    stopChatPolling(connId);
    stopSubscriberPolling(connId);
    if (isAuthError(err)) {
      markState(connId, 'ERROR', 'YouTube access was revoked or expired. Please reconnect your channel.');
      notify(connId);
      return;
    }
    // Live chat ended, quota exhausted, or transient error — go back to discovery.
    markState(connId, 'RECONNECTING', String(err.message || err));
    notify(connId);
    scheduleDiscovery(connId);
  }
}

function startChatPolling(connId) {
  const rt = runtimes.get(connId);
  if (!rt) return;
  clearTimeout(rt.chatTimer);
  scheduleChat(connId);
}

function stopChatPolling(connId) {
  const rt = runtimes.get(connId);
  if (!rt) return;
  clearTimeout(rt.chatTimer);
  rt.chatTimer = null;
  rt.pageToken = null;
}

// --- SUBSCRIBER / MILESTONE MONITORING -------------------------------------
function scheduleSubscribers(connId) {
  const rt = runtimes.get(connId);
  if (!rt || rt.stopping) return;
  clearTimeout(rt.subTimer);
  rt.subTimer = setTimeout(() => subscriberTick(connId), config.subscriberPollIntervalMs);
}

async function subscriberTick(connId) {
  const rt = runtimes.get(connId);
  if (!rt || rt.stopping) return;
  const conn = reload(connId);
  if (!conn) return;
  try {
    await checkSubscribers(conn, rt);
  } catch {
    // Non-fatal: subscriber polling is best-effort.
  }
  scheduleSubscribers(connId);
}

function startSubscriberPolling(connId) {
  const rt = runtimes.get(connId);
  if (!rt) return;
  clearTimeout(rt.subTimer);
  scheduleSubscribers(connId);
}

function stopSubscriberPolling(connId) {
  const rt = runtimes.get(connId);
  if (!rt) return;
  clearTimeout(rt.subTimer);
  rt.subTimer = null;
}

// --- lifecycle --------------------------------------------------------------
export function startConnection(connId) {
  const conn = reload(connId);
  if (!conn) return;
  const rt = runtimeFor(conn);
  rt.stopping = false;
  rt.wasLive = conn.state === 'LIVE';
  rt.liveChatId = conn.live_chat_id || null;
  if (conn.state === 'LIVE') {
    startChatPolling(connId);
    startSubscriberPolling(connId);
  } else {
    scheduleDiscovery(connId);
  }
}

export function stopConnection(connId) {
  const rt = runtimes.get(connId);
  if (!rt) return;
  rt.stopping = true;
  clearTimeout(rt.liveTimer);
  clearTimeout(rt.chatTimer);
  clearTimeout(rt.subTimer);
  runtimes.delete(connId);
}

export function refreshConnection(connId) {
  const rt = runtimes.get(connId);
  if (!rt) return startConnection(connId);
  clearTimeout(rt.liveTimer);
  clearTimeout(rt.chatTimer);
  clearTimeout(rt.subTimer);
  discoveryTick(connId);
}

export function startAllConnections() {
  for (const conn of all('SELECT * FROM youtube_connections')) {
    startConnection(conn.id);
  }
}

export function stopAllConnections() {
  for (const id of [...runtimes.keys()]) stopConnection(id);
}
