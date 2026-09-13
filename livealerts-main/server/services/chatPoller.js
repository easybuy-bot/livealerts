import { run } from '../db.js';
import { nowIso } from '../util.js';
import { pollLiveChat } from './youtubeClient.js';
import { normalizeLiveChatItem } from './normalizer.js';
import { handleEvent } from './alertEngine.js';

/**
 * LIVE EVENT PROCESSING: poll the live chat and feed normalized events to the
 * alert engine. Deduplicates by message id so a poll never double-fires.
 */
export async function pollChatOnce(conn, state) {
  const res = await pollLiveChat(conn, state.liveChatId, state.pageToken || null);
  state.pageToken = res.nextPageToken;
  state.pollInterval = res.pollingIntervalMillis || state.pollInterval;

  for (const item of res.items || []) {
    if (state.seen.has(item.id)) continue;
    state.seen.add(item.id);
    if (state.seen.size > 5000) {
      // Keep the dedup set bounded (oldest messages are irrelevant after a while).
      const arr = [...state.seen];
      state.seen = new Set(arr.slice(-2500));
    }
    const event = normalizeLiveChatItem(item);
    if (!event) continue;
    handleEvent({ userId: conn.user_id, connectionId: conn.id, event });
  }

  run('UPDATE youtube_connections SET last_event_poll = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), conn.id);
}
