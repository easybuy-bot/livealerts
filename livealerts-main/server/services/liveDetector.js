import { run } from '../db.js';
import { nowIso } from '../util.js';
import {
  getChannelInfo, getLatestVideoIds, getVideoDetails, getLiveChatId,
} from './youtubeClient.js';

/**
 * LIVE DISCOVERY (separate from event processing).
 * Uses the cheap path: channels.list (1u) -> playlistItems.list (1u) ->
 * videos.list (1u) instead of search.list (100u), to stay quota-friendly.
 *
 * Returns { live, videoId, title, liveChatId }.
 */
export async function checkLive(conn) {
  const channel = await getChannelInfo(conn);
  if (!channel) throw new Error('Could not read your YouTube channel');

  // Cache channel metadata + uploads playlist id on the connection row.
  run(
    `UPDATE youtube_connections
     SET channel_id = ?, channel_title = ?, channel_thumbnail = ?, subscriber_count = ?, updated_at = ?
     WHERE id = ?`,
    channel.channelId, channel.title, channel.thumbnail, channel.subscriberCount, nowIso(), conn.id
  );

  if (!channel.uploadsPlaylistId) {
    return { live: false, videoId: null, title: null, liveChatId: null };
  }

  const videoIds = await getLatestVideoIds(conn, channel.uploadsPlaylistId, 5);
  if (!videoIds.length) return { live: false, videoId: null, title: null, liveChatId: null };

  const videos = await getVideoDetails(conn, videoIds);
  const liveVideo = videos.find((v) => v.snippet?.liveBroadcastContent === 'live');
  if (!liveVideo) return { live: false, videoId: null, title: null, liveChatId: null };

  const videoId = liveVideo.id;
  const title = liveVideo.snippet?.title || '';
  let liveChatId = null;
  try {
    liveChatId = await getLiveChatId(conn, videoId);
  } catch {
    liveChatId = null; // some streams (e.g. premieres) may not expose chat yet
  }
  return { live: true, videoId, title, liveChatId };
}

export function markLive(connId, { videoId, title, liveChatId }) {
  run(
    `UPDATE youtube_connections
     SET state = 'LIVE', live_video_id = ?, live_chat_id = ?, live_title = ?, last_live_check = ?, last_error = NULL, updated_at = ?
     WHERE id = ?`,
    videoId, liveChatId, title, nowIso(), nowIso(), connId
  );
}

export function markOffline(connId, reason = null) {
  run(
    `UPDATE youtube_connections
     SET state = 'OFFLINE', live_video_id = NULL, live_chat_id = NULL, live_title = NULL, last_live_check = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
    nowIso(), reason, nowIso(), connId
  );
}

export function markState(connId, state, error = null) {
  run(
    `UPDATE youtube_connections SET state = ?, last_error = ?, updated_at = ? WHERE id = ?`,
    state, error, nowIso(), connId
  );
}
