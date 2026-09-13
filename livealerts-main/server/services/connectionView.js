/** Sanitized connection shape for API/dashboard — never leaks tokens. */
export function publicConnection(conn) {
  if (!conn) return null;
  return {
    id: conn.id,
    userId: conn.user_id,
    channelId: conn.channel_id,
    channelTitle: conn.channel_title,
    channelThumbnail: conn.channel_thumbnail,
    subscriberCount: conn.subscriber_count,
    state: conn.state,
    liveVideoId: conn.live_video_id,
    liveChatId: conn.live_chat_id,
    liveTitle: conn.live_title,
    lastLiveCheck: conn.last_live_check,
    lastEventPoll: conn.last_event_poll,
    lastError: conn.last_error,
    createdAt: conn.created_at,
    updatedAt: conn.updated_at,
  };
}
