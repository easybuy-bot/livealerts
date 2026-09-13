import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PORT = 4100 + Math.floor(Math.random() * 500);
process.env.PORT = String(PORT);
process.env.DB_PATH = '/tmp/la-test-api.db';
process.env.APP_SECRET = 'test-secret-for-api';
process.env.ADMIN_EMAILS = 'boss@test.com';
process.env.SITE_URL = `http://localhost:${PORT}`;
for (const f of ['/tmp/la-test-api.db', '/tmp/la-test-api.db-wal', '/tmp/la-test-api.db-shm']) fs.rmSync(f, { force: true });

const { start, stop } = await import('../server/index.js');

let cookieA = '';
let cookieB = '';

async function req(path, opts = {}, cookie = '') {
  const res = await fetch(`http://localhost:${PORT}${path}`, {
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  const data = await res.json().catch(() => ({}));
  return { res, data, setCookie };
}

test('server boots and health check passes', async () => {
  await start();
  const { res, data } = await req('/api/health');
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
});

test('full user flow: register -> overlay -> clone -> test -> history', async () => {
  const reg = await req('/api/auth/register', { method: 'POST', body: { email: 'a@test.com', password: 'password123', name: 'User A' } });
  assert.equal(reg.res.status, 200);
  cookieA = reg.res.headers.get('set-cookie').split(';')[0];

  const me = await req('/api/auth/me', {}, cookieA);
  assert.equal(me.data.user.email, 'a@test.com');

  const ov = await req('/api/overlays', { method: 'POST', body: { name: 'Main', width: 1920, height: 1080 } }, cookieA);
  assert.equal(ov.res.status, 201);
  const overlay = ov.data.overlay;
  assert.ok(overlay.token);

  const list = await req('/api/templates?eventType=SUPER_CHAT', {}, cookieA);
  const tpl = list.data.templates[0];

  const clone = await req(`/api/templates/${tpl.id}/use`, { method: 'POST', body: {} }, cookieA);
  assert.equal(clone.res.status, 200);
  const userTpl = clone.data.template;

  const testAlert = await req(`/api/my-templates/${userTpl.id}/test`, { method: 'POST', body: { username: 'Rahul', amount: 500, currency: 'INR', message: 'hi' } }, cookieA);
  assert.equal(testAlert.data.sent, true);

  const events = await req('/api/events', {}, cookieA);
  assert.equal(events.data.events.length, 1);
  assert.equal(events.data.events[0].eventType, 'SUPER_CHAT');

  const info = await req(`/overlay/${overlay.token}/info`);
  assert.equal(info.res.status, 200);
  assert.equal(info.data.overlay.width, 1920);
});

test('multi-user isolation: user B cannot touch user A resources', async () => {
  const regB = await req('/api/auth/register', { method: 'POST', body: { email: 'b@test.com', password: 'password123', name: 'User B' } });
  cookieB = regB.res.headers.get('set-cookie').split(';')[0];

  // User A's overlay list
  const aOverlays = await req('/api/overlays', {}, cookieA);
  const aOverlayId = aOverlays.data.overlays[0].id;

  // B tries to read A's overlay
  const bRead = await req(`/api/overlays/${aOverlayId}`, {}, cookieB);
  assert.equal(bRead.res.status, 404);

  // A's user template id
  const aTpls = await req('/api/my-templates', {}, cookieA);
  const aTplId = aTpls.data.templates[0].id;

  // B tries to update A's template
  const bUpdate = await req(`/api/my-templates/${aTplId}`, { method: 'PUT', body: { name: 'hacked' } }, cookieB);
  assert.equal(bUpdate.res.status, 404);

  // B's events are empty
  const bEvents = await req('/api/events', {}, cookieB);
  assert.equal(bEvents.data.events.length, 0);
});

test('unauthenticated requests are rejected', async () => {
  const r = await req('/api/overlays');
  assert.equal(r.res.status, 401);
});

// --- regression tests for repaired defects ---------------------------------

test('media upload honours the kind field (multipart parsed before use)', async () => {
  // Regression: `kind` was read from req.body before multer parsed the
  // multipart body, so every upload was silently stored as kind="image".
  const fd = new FormData();
  fd.set('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' }), 'ding.mp3');
  fd.set('kind', 'sound');
  const up = await fetch(`http://localhost:${PORT}/api/media`, {
    method: 'POST', headers: { Cookie: cookieA }, body: fd,
  });
  const upData = await up.json();
  assert.equal(up.status, 201, JSON.stringify(upData));
  assert.equal(upData.media.kind, 'sound');

  const listed = await req('/api/media?kind=sound', {}, cookieA);
  assert.ok(listed.data.media.some((m) => m.id === upData.media.id));
});

test('media upload rejects an invalid kind', async () => {
  const fd = new FormData();
  fd.set('file', new Blob([new Uint8Array([1])], { type: 'image/png' }), 'x.png');
  fd.set('kind', 'not-a-kind');
  const up = await fetch(`http://localhost:${PORT}/api/media`, {
    method: 'POST', headers: { Cookie: cookieA }, body: fd,
  });
  assert.equal(up.status, 400);
});

test('categories / favorites / recent endpoints back the library UI', async () => {
  const cats = await req('/api/templates/categories', {}, cookieA);
  assert.equal(cats.res.status, 200);
  assert.ok(cats.data.categories.length > 0, 'categories must be server-driven');

  const list = await req('/api/templates?premium=free', {}, cookieA);
  const first = list.data.templates[0];

  await req(`/api/templates/${first.id}/favorite`, { method: 'POST', body: {} }, cookieA);
  const favs = await req('/api/templates/favorites', {}, cookieA);
  assert.ok(favs.data.templates.some((t) => t.id === first.id));

  await req(`/api/templates/${first.id}/favorite`, { method: 'DELETE' }, cookieA);
  const favs2 = await req('/api/templates/favorites', {}, cookieA);
  assert.ok(!favs2.data.templates.some((t) => t.id === first.id));

  // "Use Template" clones and must record usage so Recently Used populates.
  await req(`/api/templates/${first.id}/use`, { method: 'POST', body: {} }, cookieA);
  const recent = await req('/api/templates/recent', {}, cookieA);
  assert.ok(recent.data.templates.some((t) => t.id === first.id), 'recordUsage must run on clone');
});

test('My Templates supports rename, duplicate and delete', async () => {
  const mine = await req('/api/my-templates', {}, cookieA);
  const tpl = mine.data.templates[0];
  assert.ok(tpl, 'user should own at least one cloned template');

  const renamed = await req(`/api/my-templates/${tpl.id}`, { method: 'PUT', body: { name: 'Renamed Alert' } }, cookieA);
  assert.equal(renamed.data.template.name, 'Renamed Alert');

  const dup = await req(`/api/my-templates/${tpl.id}/duplicate`, { method: 'POST', body: {} }, cookieA);
  assert.equal(dup.res.status, 201);
  assert.notEqual(dup.data.template.id, tpl.id);

  const del = await req(`/api/my-templates/${dup.data.template.id}`, { method: 'DELETE' }, cookieA);
  assert.equal(del.res.status, 200);
  const after = await req(`/api/my-templates/${dup.data.template.id}`, {}, cookieA);
  assert.equal(after.res.status, 404);

  // ownership still enforced
  const stolen = await req(`/api/my-templates/${tpl.id}`, { method: 'DELETE' }, cookieB);
  assert.equal(stolen.res.status, 404);
});

test('admin stats require admin, and ADMIN_EMAILS grants it', async () => {
  // Regression: is_admin could never be set, so /api/admin/stats was unreachable.
  const denied = await req('/api/admin/stats', {}, cookieA);
  assert.equal(denied.res.status, 403);

  const boss = await req('/api/auth/register', { method: 'POST', body: { email: 'boss@test.com', password: 'password123', name: 'Boss' } });
  assert.equal(boss.data.user.is_admin, 1);
  const bossCookie = boss.res.headers.get('set-cookie').split(';')[0];

  const stats = await req('/api/admin/stats', {}, bossCookie);
  assert.equal(stats.res.status, 200);
  assert.ok(stats.data.stats.templates > 0);
  assert.ok(stats.data.stats.users >= 2);
});

// must stay last: closes the shared test server
test('shutdown', async () => {
  await stop();
});
