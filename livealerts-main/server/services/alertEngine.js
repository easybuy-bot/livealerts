import { all, run } from '../db.js';
import { uid, nowIso, safeJsonParse, sleep } from '../util.js';
import { config } from '../config.js';
import { eventVariables } from './normalizer.js';
import { emitToOverlay, emitToUser } from './realtime.js';

// Per-overlay sequential queues, sorted by priority (higher first).
const queues = new Map(); // overlayId -> { token, items: [], processing: false }

function getQueue(overlay) {
  let q = queues.get(overlay.id);
  if (!q) {
    q = { token: overlay.token, items: [], processing: false };
    queues.set(overlay.id, q);
  }
  return q;
}

function enqueue(overlay, alert) {
  const q = getQueue(overlay);
  q.items.push(alert);
  q.items.sort((a, b) => (b.priority - a.priority) || (a.ts - b.ts));
  if (q.items.length > config.maxQueuePerOverlay) q.items.length = config.maxQueuePerOverlay;
  processQueue(overlay, q);
}

async function processQueue(overlay, q) {
  if (q.processing) return;
  q.processing = true;
  try {
    while (q.items.length) {
      const alert = q.items.shift();
      emitToOverlay(q.token, 'alert', alert);
      emitToUser(overlay.user_id, 'alert:shown', {
        overlayId: overlay.id,
        eventType: alert.eventType,
        username: alert.event?.username || '',
      });
      await sleep(alert.duration || config.defaultAlertDurationMs);
    }
  } finally {
    q.processing = false;
  }
}

function matchesConditions(assignment, event) {
  const c = safeJsonParse(assignment.conditions, {});
  if (!c || Object.keys(c).length === 0) return true;
  if (event.amount != null) {
    if (c.minAmount != null && event.amount < c.minAmount) return false;
    if (c.maxAmount != null && event.amount > c.maxAmount) return false;
  }
  if (c.minSubscribers != null && event.subscriberCount != null && event.subscriberCount < c.minSubscribers) return false;
  return true;
}

function resolveAssignment(overlay, event) {
  const rows = all(
    `SELECT a.*, ut.name AS template_name, ut.configuration AS template_config
     FROM alert_assignments a
     JOIN user_templates ut ON ut.id = a.user_template_id
     WHERE a.overlay_id = ? AND a.event_type = ? AND a.enabled = 1 AND ut.user_id = ?
     ORDER BY a.priority DESC`,
    overlay.id, event.type, overlay.user_id
  );
  const matching = rows.filter((a) => matchesConditions(a, event));
  if (!matching.length) return null;
  // Random variation among matching templates (same priority group).
  const top = matching[0].priority;
  const topGroup = matching.filter((a) => a.priority === top);
  const pick = topGroup[Math.floor(Math.random() * topGroup.length)];
  return pick;
}

/**
 * Core entry point: a normalized event for a user is persisted, routed to the
 * correct overlay(s), matched against alert rules, and queued for delivery.
 */
export function handleEvent({ userId, connectionId, overlayId = null, event }) {
  const vars = eventVariables(event);
  const payload = JSON.stringify(event);

  // Persist to event history (always scoped to the user).
  run(
    `INSERT INTO events (id, user_id, overlay_id, connection_id, event_type, username, amount, currency, message, payload, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    event.id || uid('evt'), userId, overlayId, connectionId || null,
    event.type, event.username || null, event.amount ?? null, event.currency || null,
    event.message || null, payload, nowIso()
  );

  const overlays = overlayId
    ? all('SELECT * FROM overlays WHERE id = ? AND user_id = ?', overlayId, userId)
    : all('SELECT * FROM overlays WHERE user_id = ?', userId);

  for (const overlay of overlays) {
    const assignment = resolveAssignment(overlay, event);
    if (!assignment) continue;
    const templateConfig = safeJsonParse(assignment.template_config, {});
    const duration = Number(templateConfig.duration) || config.defaultAlertDurationMs;
    enqueue(overlay, {
      id: uid('alrt'),
      eventType: event.type,
      priority: assignment.priority || 1,
      ts: Date.now(),
      duration,
      template: {
        id: assignment.user_template_id,
        name: assignment.template_name,
        configuration: templateConfig,
      },
      variables: vars,
      event,
    });
  }

  emitToUser(userId, 'event', { eventType: event.type, username: event.username || '' });
}

/** Test mode: run a synthetic event through the exact same engine path. */
export function handleTestEvent({ userId, overlayId, event }) {
  return handleEvent({ userId, overlayId, event });
}
