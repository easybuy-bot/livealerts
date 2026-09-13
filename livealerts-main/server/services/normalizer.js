import { uid } from '../util.js';

export const EVENT_TYPES = [
  'SUBSCRIBER',
  'SUPER_CHAT',
  'SUPER_STICKER',
  'NEW_MEMBER',
  'MEMBER_MILESTONE',
  'GIFT_MEMBERSHIP',
  'GIFT_MEMBERSHIP_RECEIVED',
  'LIVE_START',
  'LIVE_END',
  'MILESTONE',
];

export const EVENT_LABELS = {
  SUBSCRIBER: 'Subscriber',
  SUPER_CHAT: 'Super Chat',
  SUPER_STICKER: 'Super Sticker',
  NEW_MEMBER: 'New Member',
  MEMBER_MILESTONE: 'Member Milestone',
  GIFT_MEMBERSHIP: 'Gift Membership',
  GIFT_MEMBERSHIP_RECEIVED: 'Gift Membership Received',
  LIVE_START: 'Live Start',
  LIVE_END: 'Live End',
  MILESTONE: 'Milestone',
};

function microsToUnits(micros) {
  return micros == null ? null : Number(micros) / 1e6;
}

function author(item) {
  const a = item.authorDetails || {};
  return {
    username: a.displayName || 'Someone',
    profilePicture: a.profileImageUrl || '',
    isVerified: !!a.isVerified,
    isOwner: !!a.isChatOwner,
    isModerator: !!a.isChatModerator,
    isSponsor: !!a.isChatSponsor,
  };
}

/**
 * Map one raw YouTube liveChatMessages.list item into a normalized internal event,
 * or null when the item type is not an alert-relevant event (e.g. plain text chat).
 */
export function normalizeLiveChatItem(item) {
  const sn = item.snippet || {};
  const who = author(item);
  const base = {
    id: item.id,
    timestamp: sn.publishedAt || new Date().toISOString(),
    ...who,
  };

  switch (sn.type) {
    case 'superChatEvent': {
      const d = sn.superChatDetails || {};
      return {
        ...base,
        type: 'SUPER_CHAT',
        amount: microsToUnits(d.amountMicros),
        currency: d.currency || '',
        message: d.userComment || '',
        tier: d.tier || null,
      };
    }
    case 'superStickerEvent': {
      const d = sn.superStickerDetails || {};
      return {
        ...base,
        type: 'SUPER_STICKER',
        amount: microsToUnits(d.amountMicros),
        currency: d.currency || '',
        stickerId: d.superStickerMetadata?.stickerId || null,
        stickerAlt: d.superStickerMetadata?.altText || '',
      };
    }
    case 'newSponsorEvent': {
      const d = sn.newSponsorDetails || {};
      return {
        ...base,
        type: 'NEW_MEMBER',
        membershipLevel: d.memberLevelName || null,
        isUpgrade: !!d.isUpgrade,
      };
    }
    case 'memberMilestoneChatEvent': {
      const d = sn.memberMilestoneChatDetails || {};
      return {
        ...base,
        type: 'MEMBER_MILESTONE',
        message: d.userComment || '',
        membershipLevel: d.memberLevelName || null,
        memberMonths: d.memberMonth || null,
      };
    }
    case 'sponsorshipGiftPurchaseEvent': {
      const d = sn.sponsorshipGiftPurchaseDetails || {};
      return {
        ...base,
        type: 'GIFT_MEMBERSHIP',
        amount: microsToUnits(d.amountMicros),
        currency: d.currency || '',
        giftCount: d.giftCount || 1,
        membershipLevel: d.tierName || null,
      };
    }
    case 'sponsorshipGiftRedemptionEvent': {
      const d = sn.sponsorshipGiftRedemptionDetails || {};
      return {
        ...base,
        type: 'GIFT_MEMBERSHIP_RECEIVED',
        membershipLevel: d.tierName || null,
      };
    }
    default:
      return null;
  }
}

export function normalizeLiveStart({ channelName, streamTitle, videoId, timestamp }) {
  return {
    id: uid('evt'),
    type: 'LIVE_START',
    username: channelName || '',
    channelName: channelName || '',
    streamTitle: streamTitle || '',
    videoId: videoId || null,
    timestamp: timestamp || new Date().toISOString(),
  };
}

export function normalizeLiveEnd({ channelName, timestamp }) {
  return {
    id: uid('evt'),
    type: 'LIVE_END',
    username: channelName || '',
    channelName: channelName || '',
    timestamp: timestamp || new Date().toISOString(),
  };
}

export function normalizeSubscriber({ channelName, subscriberCount, delta, timestamp }) {
  return {
    id: uid('evt'),
    type: 'SUBSCRIBER',
    username: 'New Subscriber',
    channelName: channelName || '',
    subscriberCount: subscriberCount || null,
    delta: delta || 1,
    timestamp: timestamp || new Date().toISOString(),
  };
}

export function normalizeMilestone({ channelName, subscriberCount, threshold, timestamp }) {
  return {
    id: uid('evt'),
    type: 'MILESTONE',
    username: channelName || '',
    channelName: channelName || '',
    subscriberCount: subscriberCount || null,
    threshold: threshold || null,
    timestamp: timestamp || new Date().toISOString(),
  };
}

/**
 * Expand a normalized event into the variable map used by the template renderer.
 * These are the {placeholders} available in template text layers.
 */
export function eventVariables(event) {
  const v = {
    username: event.username || '',
    amount: event.amount != null ? String(event.amount) : '',
    currency: event.currency || '',
    message: event.message || '',
    membership_level: event.membershipLevel || '',
    member_months: event.memberMonths != null ? String(event.memberMonths) : '',
    gift_count: event.giftCount != null ? String(event.giftCount) : '',
    channel_name: event.channelName || '',
    stream_title: event.streamTitle || '',
    subscriber_count: event.subscriberCount != null ? String(event.subscriberCount) : '',
    threshold: event.threshold != null ? String(event.threshold) : '',
    profile_picture: event.profilePicture || '',
    sticker: event.stickerId || '',
    sticker_alt: event.stickerAlt || '',
  };
  return v;
}
