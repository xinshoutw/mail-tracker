import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { checkAuth, esc, isBot, jsonForScript, trackerMeta } from '../src/shared.js';
import { renderDetail } from '../src/views/detail.js';
import { renderDashboard } from '../src/views/dashboard.js';

// A password with a colon in it, because splitting on every colon used to lock
// the owner out permanently.
const PASSWORD = 'pa:ss word';
const AUTH = 'Basic ' + Buffer.from(`:${PASSWORD}`).toString('base64');
const SENDER_IP = '203.0.113.9';
const OPENER_IP = '198.51.100.4';

/**
 * Minimal in-memory stand-in for the KV binding, including list() metadata.
 * `ops` counts calls by kind: the free plan meters reads and lists on wildly
 * different budgets (100,000/day vs 1,000/day), so which one a code path spends
 * is worth asserting on, not just whether it works.
 */
function fakeKV() {
  const store = new Map();
  const ops = { get: 0, put: 0, delete: 0, list: 0 };
  return {
    store,
    ops,
    async get(name, type) {
      ops.get++;
      const hit = store.get(name);
      if (!hit) return null;
      return type === 'json' ? JSON.parse(hit.value) : hit.value;
    },
    async put(name, value, opts = {}) {
      ops.put++;
      store.set(name, { value, metadata: opts.metadata ?? null });
    },
    async delete(name) {
      ops.delete++;
      store.delete(name);
    },
    async list({ prefix = '', limit = 1000 } = {}) {
      ops.list++;
      const keys = [...store.entries()]
        .filter(([name]) => name.startsWith(prefix))
        .slice(0, limit)
        .map(([name, entry]) => ({ name, metadata: entry.metadata ?? undefined }));
      return { keys, list_complete: true, cursor: null };
    },
  };
}

function req(path, { method = 'GET', auth = true, body, headers = {} } = {}) {
  const h = new Headers(headers);
  if (auth) h.set('Authorization', AUTH);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  return new Request(`https://tracker.test${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let env;
beforeEach(() => {
  env = { TRACKER: fakeKV(), DASHBOARD_PASSWORD: PASSWORD };
});

async function createTracker(overrides = {}) {
  const res = await worker.fetch(
    req('/new', { method: 'POST', body: { to: 'her@example.com', subject: 'Hi', ...overrides }, headers: { 'cf-connecting-ip': SENDER_IP } }),
    env,
  );
  assert.equal(res.status, 200);
  return (await res.json()).id;
}

function openPixel(id, { ip = OPENER_IP, userAgent = 'Mozilla/5.0' } = {}) {
  return worker.fetch(
    req(`/t/${id}`, { auth: false, headers: { 'cf-connecting-ip': ip, 'user-agent': userAgent, 'cf-ipcountry': 'TW' } }),
    env,
  );
}

const read = id => env.TRACKER.get(id, 'json');

// ---------------------------------------------------------------- escaping --

describe('escaping', () => {
  test('jsonForScript stops a value from closing the inline script', () => {
    const out = jsonForScript({ ua: '</script><script>alert(1)</script>' });
    assert.ok(!out.includes('</script>'), 'raw </script> must not survive');
    assert.equal(JSON.parse(out).ua, '</script><script>alert(1)</script>');
  });

  test('jsonForScript escapes comment openers and line separators', () => {
    assert.ok(!jsonForScript('<!--').includes('<'));
    assert.ok(!jsonForScript('a b').includes(' '));
  });

  test('esc covers every HTML entity that can break out of markup', () => {
    assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    // Guards a single-quoted attribute, should one ever be introduced.
    assert.equal(esc("x' onerror='alert(1)"), 'x&#39; onerror=&#39;alert(1)');
  });

  test('a hostile User-Agent cannot break out of the detail page', () => {
    const html = renderDetail('abc', {
      opens: 1,
      events: [{ time: '2026-01-01T00:00:00Z', ip: '1.2.3.4', country: 'US', userAgent: '</script><script>alert(1)</script>' }],
      filteredEvents: [],
    }, 'test-nonce');
    assert.equal(html.match(/<\/script>/g).length, 1, 'only the real closing tag may appear');
    assert.ok(html.includes('<script nonce="test-nonce">'));
  });

  test('a hostile subject cannot break out of the dashboard', () => {
    const html = renderDashboard([{ id: 'a', subject: '</script><img src=x onerror=alert(1)>' }], 0, 0, 'n');
    assert.equal(html.match(/<\/script>/g).length, 1);
  });
});

// -------------------------------------------------------------------- auth --

describe('checkAuth', () => {
  const withHeader = value => ({ headers: { get: k => (k === 'Authorization' ? value : null) } });

  test('accepts a password containing colons', () => {
    assert.equal(checkAuth(withHeader(AUTH), env), true);
  });

  test('rejects the password truncated at its first colon', () => {
    const truncated = 'Basic ' + Buffer.from(':pa').toString('base64');
    assert.equal(checkAuth(withHeader(truncated), env), false);
  });

  test('rejects malformed base64 instead of throwing', () => {
    assert.equal(checkAuth(withHeader('Basic @@@not base64@@@'), env), false);
  });

  test('rejects a missing or non-Basic header', () => {
    assert.equal(checkAuth(withHeader(null), env), false);
    assert.equal(checkAuth(withHeader('Bearer token'), env), false);
  });

  test('fails closed when no password is configured', () => {
    assert.equal(checkAuth(withHeader(AUTH), {}), false);
  });
});

describe('route auth', () => {
  test('unauthenticated dashboard gets a 401 challenge', async () => {
    const res = await worker.fetch(req('/', { auth: false }), env);
    assert.equal(res.status, 401);
    assert.match(res.headers.get('WWW-Authenticate'), /^Basic/);
  });

  test('the extension feed is not readable without the password', async () => {
    const res = await worker.fetch(req('/feed', { auth: false }), env);
    assert.equal(res.status, 401);
  });

  test('an unconfigured worker answers 503, not an open dashboard', async () => {
    const res = await worker.fetch(req('/', { auth: false }), { TRACKER: env.TRACKER });
    assert.equal(res.status, 503);
    assert.match(await res.text(), /DASHBOARD_PASSWORD/);
  });
});

// --------------------------------------------------------- open filtering --

describe('open filtering', () => {
  test('records an open from a third party', async () => {
    const id = await createTracker();
    await openPixel(id);
    const data = await read(id);
    assert.equal(data.opens, 1);
    assert.equal(data.events[0].country, 'TW');
  });

  test('a Gmail image proxy fetch counts as a real open', async () => {
    // Gmail routes every image through this proxy, so it is the only signal a
    // Gmail recipient ever produces. Treating it as a bot zeroed them all out.
    const id = await createTracker();
    await openPixel(id, { userAgent: 'Mozilla/5.0 (via ggpht.com GoogleImageProxy)', ip: '66.249.84.1' });
    assert.equal((await read(id)).opens, 1);
  });

  test('a link-safety scanner does not', async () => {
    const id = await createTracker();
    await openPixel(id, { userAgent: 'Microsoft Outlook Safelinks' });
    const data = await read(id);
    assert.equal(data.opens, 0);
    assert.equal(data.filteredEvents[0].reason, 'bot_proxy');
  });

  test("the sender's own IP is skipped", async () => {
    const id = await createTracker();
    await openPixel(id, { ip: SENDER_IP });
    const data = await read(id);
    assert.equal(data.opens, 0);
    assert.equal(data.filteredEvents[0].reason, 'sender_ip');
  });

  test('a repeat hit from the same IP within the dedup window counts once', async () => {
    const id = await createTracker();
    await openPixel(id);
    await openPixel(id);
    assert.equal((await read(id)).opens, 1);
  });

  test('isBot ignores ordinary mail clients', () => {
    assert.equal(isBot('Mozilla/5.0 (via ggpht.com GoogleImageProxy)'), false);
    assert.equal(isBot('Mozilla/5.0 Thunderbird/128.0'), false);
    assert.equal(isBot('Mozilla/5.0 Safelinks'), true);
    assert.equal(isBot(''), false);
  });

  test('a hammered bot hit is not written to KV every time', async () => {
    // /t/:id takes no auth, so an unbounded write per request was free for
    // anyone holding the pixel URL.
    const id = await createTracker();
    for (let i = 0; i < 5; i++) await openPixel(id, { userAgent: 'Safelinks' });
    const data = await read(id);
    assert.equal(data.skipped, 1, 'only the first hit in the window is recorded');
    assert.equal(data.filteredEvents.length, 1);
  });

  test('a hammered sender-IP hit is likewise written once', async () => {
    const id = await createTracker();
    for (let i = 0; i < 5; i++) await openPixel(id, { ip: SENDER_IP });
    assert.equal((await read(id)).filteredEvents.length, 1);
  });

  test('an unknown pixel still serves a PNG without creating a record', async () => {
    const res = await openPixel('does-not-exist');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'image/png');
    assert.equal(env.TRACKER.store.size, 0);
  });
});

// ------------------------------------------------------- state-change verbs --

describe('state-changing routes', () => {
  test('creating a tracker over GET is refused', async () => {
    assert.equal((await worker.fetch(req('/new'), env)).status, 405);
  });

  test('deleting over GET is refused, so an <img> tag cannot do it', async () => {
    const id = await createTracker();
    assert.equal((await worker.fetch(req(`/d/${id}`), env)).status, 405);
    assert.ok(await read(id), 'tracker must survive the GET');
  });

  test('DELETE removes the tracker', async () => {
    const id = await createTracker();
    const res = await worker.fetch(req(`/d/${id}`, { method: 'DELETE' }), env);
    assert.equal(res.status, 200);
    assert.equal(await read(id), null);
  });

  test('worker-owned keys are not addressable', async () => {
    assert.equal((await worker.fetch(req('/d/__pending__:1:a', { method: 'DELETE' }), env)).status, 400);
    assert.equal((await worker.fetch(req('/s/__pending__:1:a'), env)).status, 400);
  });

  test('rejects a malformed recipient and oversized input', async () => {
    const bad = await worker.fetch(req('/new', { method: 'POST', body: { to: 'not-an-email' } }), env);
    assert.equal(bad.status, 400);
    const long = await worker.fetch(req('/new', { method: 'POST', body: { subject: 'x'.repeat(501) } }), env);
    assert.equal(long.status, 400);
  });

  test('/self refuses an unbounded batch', async () => {
    const res = await worker.fetch(req('/self', { method: 'POST', body: { ids: Array(51).fill('a') } }), env);
    assert.equal(res.status, 400);
  });

  test('/self reclassifies a recent open as a self-view', async () => {
    const id = await createTracker();
    await openPixel(id);
    const res = await worker.fetch(req('/self', { method: 'POST', body: { ids: [id] } }), env);
    assert.equal((await res.json()).totalReclassified, 1);
    const data = await read(id);
    assert.equal(data.opens, 0);
    assert.equal(data.filteredEvents.at(-1).reason, 'self_view');
  });
});

// ---------------------------------------------------------------- listings --

describe('listings', () => {
  test('/list renders from metadata and hides worker-owned keys', async () => {
    const id = await createTracker();
    await openPixel(id);
    const rows = await (await worker.fetch(req('/list'), env)).json();
    assert.equal(rows.length, 1, 'the queued webhook key must not appear');
    assert.equal(rows[0].id, id);
    assert.equal(rows[0].opens, 1);
    assert.ok(rows[0].createdAt, 'the extension sorts on createdAt');
  });

  test('the dashboard keeps its Content-Security-Policy and hides internal keys', async () => {
    await createTracker();
    const res = await worker.fetch(req('/'), env);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Security-Policy'), /script-src 'nonce-/);
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  });

  test('/s/:id as JSON never leaks the sender IP', async () => {
    const id = await createTracker();
    const stats = await (await worker.fetch(req(`/s/${id}?format=json`), env)).json();
    assert.equal(stats.senderIp, undefined);
    assert.equal(stats.hasSenderProtection, true);
  });

  test('trackerMeta stays inside the 1024-byte KV metadata cap', () => {
    const meta = trackerMeta({
      opens: 3,
      recipient: 'someone@example.com',
      subject: '主'.repeat(500),
      bodyPreview: '旨'.repeat(500),
      events: [{ time: '2026-01-01T00:00:00Z' }],
    });
    assert.ok(new TextEncoder().encode(JSON.stringify(meta)).length <= 1024);
    assert.equal(meta.lastOpen, '2026-01-01T00:00:00Z');
  });
});

// ------------------------------------------------------------ webhook cron --

describe('scheduled webhooks', () => {
  let sent;
  let realFetch;

  beforeEach(() => {
    sent = [];
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return new Response('ok', { status: 200 });
    };
    env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x';
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  /** Backdate the queued entry and its event so the grace period has elapsed. */
  async function ageQueue(id, ms) {
    const when = new Date(Date.now() - ms).toISOString();
    const [key] = (await env.TRACKER.list({ prefix: '__pending__:' })).keys;
    const item = await env.TRACKER.get(key.name, 'json');
    const tracker = await read(id);
    if (tracker.events.length) tracker.events.at(-1).time = when;
    await env.TRACKER.put(id, JSON.stringify(tracker));
    await env.TRACKER.put(key.name, JSON.stringify({ ...item, time: when }));
  }

  test('an idle firing spends a read, not a list operation', async () => {
    env.TRACKER.ops.get = 0;
    env.TRACKER.ops.list = 0;

    await worker.scheduled({}, env);

    // Listing an empty queue on every firing is what put the namespace over the
    // 1,000/day free-tier list limit with no traffic at all.
    assert.equal(env.TRACKER.ops.list, 0, 'empty queue must not cost a list');
    assert.equal(env.TRACKER.ops.get, 1, 'one hint read and nothing else');
    assert.equal(sent.length, 0);
  });

  test('clears the queue hint once drained, so later firings stop listing', async () => {
    const id = await createTracker();
    await openPixel(id);
    await ageQueue(id, 30_000);

    await worker.scheduled({}, env);
    assert.equal(sent.length, 1, 'drains the queued open');

    await worker.scheduled({}, env); // hint still set, queue now empty: clears it

    env.TRACKER.ops.list = 0;
    await worker.scheduled({}, env);
    assert.equal(env.TRACKER.ops.list, 0, 'hint gone, so no further listing');
  });

  test('publishes drained opens to /feed, without the opener IP', async () => {
    const id = await createTracker();
    await openPixel(id);
    await ageQueue(id, 30_000);
    await worker.scheduled({}, env);

    const { opens } = await (await worker.fetch(req('/feed'), env)).json();
    assert.equal(opens.length, 1);
    assert.equal(opens[0].id, id);
    assert.equal(opens[0].recipient, 'her@example.com');
    assert.equal(opens[0].opens, 1);
    // The feed only drives a desktop notification, which has no use for an IP.
    assert.ok(!('ip' in opens[0]), 'feed must not carry the opener IP');
  });

  test('reading the feed costs one get and no list', async () => {
    env.TRACKER.ops.get = 0;
    env.TRACKER.ops.list = 0;

    await worker.fetch(req('/feed'), env);

    // The whole point of /feed: the extension polls it every five minutes, and
    // enumerating the namespace that often is 288 of 1000 daily list operations.
    assert.equal(env.TRACKER.ops.list, 0, 'polling must not enumerate trackers');
    assert.equal(env.TRACKER.ops.get, 1);
  });

  test('caps the feed so it cannot grow without bound', async () => {
    const stale = Array.from({ length: 50 }, (_, i) => ({
      id: 'old', time: `2020-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    await env.TRACKER.put('__feed__', JSON.stringify(stale));

    const id = await createTracker();
    await openPixel(id);
    await ageQueue(id, 30_000);
    await worker.scheduled({}, env);

    const { opens } = await (await worker.fetch(req('/feed'), env)).json();
    assert.equal(opens.length, 50, 'still capped');
    assert.equal(opens.at(-1).id, id, 'newest kept');
    assert.equal(opens[0].time, '2020-01-01T00:00:01.000Z', 'oldest dropped');
  });

  test('sends one webhook per genuine open and clears the queue', async () => {
    const id = await createTracker();
    await openPixel(id);
    await ageQueue(id, 30_000);

    await worker.scheduled({}, env);
    assert.equal(sent.length, 1);
    assert.match(sent[0].body.text, /Email Opened/);
    assert.equal((await env.TRACKER.list({ prefix: '__pending__:' })).keys.length, 0);
  });

  test('holds a webhook back until the self-view grace period passes', async () => {
    const id = await createTracker();
    await openPixel(id);

    await worker.scheduled({}, env);
    assert.equal(sent.length, 0, 'too young to send');
    assert.equal((await env.TRACKER.list({ prefix: '__pending__:' })).keys.length, 1, 'still queued');
  });

  test('drops the webhook when the open was reclassified as a self-view', async () => {
    const id = await createTracker();
    await openPixel(id);
    await ageQueue(id, 30_000);
    const tracker = await read(id);
    await env.TRACKER.put(id, JSON.stringify({ ...tracker, events: [] })); // as /self would leave it

    await worker.scheduled({}, env);
    assert.equal(sent.length, 0);
  });

  test('posts a Discord embed with a native timestamp', async () => {
    delete env.SLACK_WEBHOOK_URL;
    env.DISCORD_WEBHOOK_URL = 'https://discord.test/hook';
    const id = await createTracker();
    await openPixel(id);
    await ageQueue(id, 30_000);

    await worker.scheduled({}, env);
    assert.equal(sent.length, 1);
    const [embed] = sent[0].body.embeds;
    assert.equal(embed.fields.find(f => f.name === 'Recipient').value, 'her@example.com');
    // Rendered by Discord in the reader's timezone; the worker only knows UTC.
    assert.match(embed.fields.find(f => f.name === 'Time').value, /^<t:\d+:f>$/);
  });

  test('a failing webhook does not stop the other one', async () => {
    env.DISCORD_WEBHOOK_URL = 'https://discord.test/hook';
    globalThis.fetch = async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      if (url.includes('slack')) throw new Error('network down');
      return new Response('ok', { status: 200 });
    };
    const id = await createTracker();
    await openPixel(id);
    await ageQueue(id, 30_000);

    await worker.scheduled({}, env);
    assert.equal(sent.length, 2, 'both were attempted');
  });

  test('escapes Slack control characters in the subject', async () => {
    const id = await createTracker({ subject: '<!channel> ping' });
    await openPixel(id);
    await ageQueue(id, 30_000);

    await worker.scheduled({}, env);
    assert.ok(!sent[0].body.text.includes('<!channel>'));
    assert.match(sent[0].body.text, /&lt;!channel&gt;/);
  });
});
