import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.DB_PATH = '/tmp/la-test-core.db';
process.env.APP_SECRET = 'test-secret-for-unit-tests';
for (const f of ['/tmp/la-test-core.db', '/tmp/la-test-core.db-wal', '/tmp/la-test-core.db-shm']) fs.rmSync(f, { force: true });

const { migrate } = await import('../server/db.js');
const { encryptSecret, decryptSecret } = await import('../server/crypto.js');
const { hashPassword, verifyPassword } = await import('../server/middleware/auth.js');
const { normalizeLiveChatItem, eventVariables } = await import('../server/services/normalizer.js');
const { seedTemplates } = await import('../server/seeds/templates.js');
const { cloneTemplateForUser, listTemplates, updateUserTemplate } = await import('../server/services/templateLibrary.js');
const { get } = await import('../server/db.js');

migrate();
seedTemplates();

test('secret encryption round-trips', () => {
  const enc = encryptSecret('super-secret-refresh-token');
  assert.notEqual(enc, 'super-secret-refresh-token');
  assert.equal(decryptSecret(enc), 'super-secret-refresh-token');
  assert.equal(decryptSecret('garbage'), '');
});

test('password hashing verifies and rejects wrong password', () => {
  const h = hashPassword('password123');
  assert.ok(verifyPassword('password123', h));
  assert.ok(!verifyPassword('wrong', h));
});

test('normalizer maps superChatEvent to SUPER_CHAT with amount in units', () => {
  const item = {
    id: 'msg1',
    snippet: {
      type: 'superChatEvent',
      publishedAt: '2026-01-01T00:00:00Z',
      superChatDetails: { amountMicros: '500000000', currency: 'INR', userComment: 'Amazing!' },
    },
    authorDetails: { displayName: 'Rahul', profileImageUrl: 'https://x/y.png' },
  };
  const ev = normalizeLiveChatItem(item);
  assert.equal(ev.type, 'SUPER_CHAT');
  assert.equal(ev.amount, 500);
  assert.equal(ev.currency, 'INR');
  assert.equal(ev.username, 'Rahul');
  assert.equal(ev.message, 'Amazing!');
});

test('normalizer ignores plain text chat messages', () => {
  const item = { id: 'm2', snippet: { type: 'textMessageEvent', textMessageDetails: { messageText: 'hi' } }, authorDetails: {} };
  assert.equal(normalizeLiveChatItem(item), null);
});

test('normalizer maps newSponsorEvent to NEW_MEMBER', () => {
  const item = { id: 'm3', snippet: { type: 'newSponsorEvent', newSponsorDetails: { memberLevelName: 'VIP' } }, authorDetails: { displayName: 'Aman' } };
  const ev = normalizeLiveChatItem(item);
  assert.equal(ev.type, 'NEW_MEMBER');
  assert.equal(ev.membershipLevel, 'VIP');
});

test('eventVariables expands placeholders', () => {
  const v = eventVariables({ username: 'Rahul', amount: 500, currency: 'INR', message: 'hi', channelName: 'Ch' });
  assert.equal(v.username, 'Rahul');
  assert.equal(v.amount, '500');
  assert.equal(v.currency, 'INR');
});

test('template library seeds at least 48 system templates', () => {
  const n = listTemplates({}).length;
  assert.ok(n >= 48, `expected >=48, got ${n}`);
});

test('cloning a system template never mutates the master (immutability)', () => {
  const src = listTemplates({ eventType: 'SUPER_CHAT' })[0];
  const clone = cloneTemplateForUser('user-test-1', src.id);
  assert.notEqual(clone.id, src.id);
  assert.equal(clone.sourceTemplateId, src.id);

  const before = JSON.stringify(get('SELECT configuration FROM templates WHERE id = ?', src.id).configuration);
  updateUserTemplate('user-test-1', clone.id, { name: 'My Custom', configuration: { duration: 9999 } });
  const after = JSON.stringify(get('SELECT configuration FROM templates WHERE id = ?', src.id).configuration);
  assert.equal(before, after);
});
