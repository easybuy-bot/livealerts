import { get, run } from '../db.js';
import { uid, nowIso } from '../util.js';
import { cloneTemplateForUser } from './templateLibrary.js';

// Default system template (by slug) used for each event type when a new user joins.
const DEFAULT_SLUGS = {
  SUBSCRIBER: 'subscriber-classic',
  SUPER_CHAT: 'super-chat-classic',
  SUPER_STICKER: 'super-sticker-pop',
  NEW_MEMBER: 'member-crown',
  MEMBER_MILESTONE: 'member-crown',
  GIFT_MEMBERSHIP: 'gift-box',
  GIFT_MEMBERSHIP_RECEIVED: 'gift-box',
  LIVE_START: 'live-now',
  LIVE_END: 'thanks-for-watching',
  MILESTONE: 'milestone-1k',
};

const MINIMAL_CONFIG = {
  duration: 6000,
  background: { type: 'gradient', gradient: { colors: ['#10102a', '#1b1b4b'], angle: 135 } },
  layers: [
    {
      id: 'username', type: 'text', text: '{username}',
      position: { x: 50, y: 46, align: 'center' },
      style: { font: 'Arial', size: 56, weight: 700, color: '#ffffff' },
      animation: { entrance: { type: 'pop', duration: 500, delay: 0 }, exit: { type: 'fade', duration: 300, delay: 5000 } },
    },
  ],
  sound: { source: null, volume: 0.8 },
};

/**
 * Ensure the user has a default user template for every supported event type.
 * Returns a map of eventType -> user_template_id.
 */
export function ensureDefaultTemplates(userId) {
  const map = {};
  for (const [eventType, slug] of Object.entries(DEFAULT_SLUGS)) {
    let existing = get(
      'SELECT id FROM user_templates WHERE user_id = ? AND event_type = ? ORDER BY created_at ASC LIMIT 1',
      userId, eventType
    );
    if (!existing) {
      const sys = get('SELECT id FROM templates WHERE slug = ? AND is_system = 1', slug);
      if (sys) {
        const cloned = cloneTemplateForUser(userId, sys.id);
        existing = { id: cloned.id };
      } else {
        const id = uid('ut');
        run(
          `INSERT INTO user_templates (id, user_id, source_template_id, name, event_type, configuration, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          id, userId, null, `Default ${eventType.replace(/_/g, ' ')} Alert`, eventType,
          JSON.stringify(MINIMAL_CONFIG), nowIso(), nowIso()
        );
        existing = { id };
      }
    }
    map[eventType] = existing.id;
  }
  return map;
}

/** Create default alert assignments for a newly created overlay. */
export function createDefaultAssignments(userId, overlayId) {
  const defaults = ensureDefaultTemplates(userId);
  const priorities = { SUBSCRIBER: 1, NEW_MEMBER: 2, SUPER_STICKER: 3, GIFT_MEMBERSHIP: 4, SUPER_CHAT: 5, LIVE_START: 6, LIVE_END: 1, MILESTONE: 7, MEMBER_MILESTONE: 2, GIFT_MEMBERSHIP_RECEIVED: 4 };
  for (const [eventType, templateId] of Object.entries(defaults)) {
    const exists = get('SELECT id FROM alert_assignments WHERE overlay_id = ? AND event_type = ?', overlayId, eventType);
    if (exists) continue;
    run(
      `INSERT INTO alert_assignments (id, user_id, overlay_id, event_type, user_template_id, priority, conditions, enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      uid('asg'), userId, overlayId, eventType, templateId, priorities[eventType] || 1, '{}', 1, nowIso(), nowIso()
    );
  }
}
