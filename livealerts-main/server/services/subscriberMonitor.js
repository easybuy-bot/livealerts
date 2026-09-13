import { all, run } from '../db.js';
import { nowIso } from '../util.js';
import { getSubscriberCount } from './youtubeClient.js';
import { normalizeSubscriber, normalizeMilestone } from './normalizer.js';
import { handleEvent } from './alertEngine.js';

const MAX_SUBSCRIBER_ALERTS_PER_CHECK = 10;

/**
 * Subscriber detection is approximated via channels.list statistics (YouTube's
 * live chat API does not expose subscriber events). We emit one SUBSCRIBER
 * alert per detected increase, and MILESTONE alerts when a threshold is crossed.
 */
export async function checkSubscribers(conn, state) {
  const count = await getSubscriberCount(conn);
  const prev = state.lastSubscriberCount ?? conn.subscriber_count ?? count;

  run('UPDATE youtube_connections SET subscriber_count = ?, updated_at = ? WHERE id = ?', count, nowIso(), conn.id);

  if (state.lastSubscriberCount != null && count > prev) {
    const delta = count - prev;
    const emitCount = Math.min(delta, MAX_SUBSCRIBER_ALERTS_PER_CHECK);
    for (let i = 0; i < emitCount; i++) {
      handleEvent({
        userId: conn.user_id,
        connectionId: conn.id,
        event: normalizeSubscriber({
          channelName: conn.channel_title,
          subscriberCount: count,
          delta: 1,
        }),
      });
    }
  }

  // Milestones
  const milestones = all(
    'SELECT * FROM milestones WHERE user_id = ? AND enabled = 1 ORDER BY threshold ASC', conn.user_id
  );
  for (const m of milestones) {
    if (prev < m.threshold && count >= m.threshold) {
      handleEvent({
        userId: conn.user_id,
        connectionId: conn.id,
        event: normalizeMilestone({
          channelName: conn.channel_title,
          subscriberCount: count,
          threshold: m.threshold,
        }),
      });
    }
  }

  state.lastSubscriberCount = count;
}
