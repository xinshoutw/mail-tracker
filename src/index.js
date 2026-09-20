import { CORS_HEADERS, DEDUP_WINDOW_MS, json, isBot, checkAuth, requireAuth, servePixel, html, putTracker, trackerMeta } from './shared.js';
import { sendWebhookNotifications } from './notifications.js';
import { renderDetail } from './views/detail.js';
import { renderDashboard } from './views/dashboard.js';

const SELF_VIEW_WINDOW_MS = 5_000;

// 8 hex chars was 32 bits: a ~50% chance of a silent overwriting collision by
// ~77k trackers, and cheap to enumerate. 16 hex chars is 64 bits.
const ID_LENGTH = 16;

// Keys the worker owns. They share the tracker namespace, so listings must skip
// them or they show up in the dashboard as phantom trackers.
const INTERNAL_PREFIX = '__';
const PENDING_PREFIX = '__pending__:';
const PENDING_TTL_S = 3600;
// Set whenever an open is queued, so scheduled() can rule out an empty queue
// with a get() instead of a list(). The free plan allows 100,000 reads a day
// but only 1,000 lists, and the cron fires on schedule whether or not anyone
// sent an email — listing unconditionally cost 1,440 lists a day at rest, over
// the daily limit before a single email was tracked, which took / and /list
// down with it because they list() too.
const QUEUE_HINT = '__queued__';
const WEBHOOK_GRACE_MS = 10_000;
// ponytail: 10 webhooks a minute is plenty for one mailbox and keeps the cron
// inside the free plan's 50-subrequest budget. Raise it with the plan if the
// queue ever backs up.
const MAX_PENDING_PER_RUN = 10;
const MAX_TRACKERS = 1000;
const MAX_LEGACY_READS = 20;
const MAX_SELF_VIEW_IDS = 50;

/**
 * A repeat hit from the same IP inside the dedup window. /t/:id is
 * unauthenticated, and the sender-IP and bot branches used to write to KV on
 * every single request, so anyone holding a pixel URL could drive unbounded
 * writes just by resending with a scanner's User-Agent.
 */
function isRepeatHit(events, ip, nowMs) {
  const last = events.length ? events[events.length - 1] : null;
  return !!last && last.ip === ip && nowMs - new Date(last.time).getTime() < DEDUP_WINDOW_MS;
}

// One subrequest per 1000 trackers instead of one per tracker. Records written
// before metadata existed still need a read, capped so an old namespace cannot
// blow the subrequest budget on its own.
async function listTrackers(env) {
  const out = [];
  let legacyReads = 0;
  let cursor;

  do {
    const page = await env.TRACKER.list({ cursor });
    for (const key of page.keys) {
      if (key.name.startsWith(INTERNAL_PREFIX)) continue;

      let meta = key.metadata;
      if (!meta && legacyReads < MAX_LEGACY_READS) {
        legacyReads++;
        const data = await env.TRACKER.get(key.name, 'json');
        if (data) meta = trackerMeta(data);
      }
      out.push({ id: key.name, ...(meta || {}) });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < MAX_TRACKERS);

  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // POST /self — extension signals sender viewed a thread (batch: multiple pixel IDs)
    // Called AFTER opens have been recorded, so we retroactively reclassify.
    if (url.pathname === '/self' && request.method === 'POST') {
      if (!checkAuth(request, env)) return requireAuth(env, CORS_HEADERS);

      let ids;
      try {
        const body = await request.json();
        ids = body.ids;
        if (!Array.isArray(ids) || ids.length === 0) return json({ error: 'ids must be a non-empty array' }, 400);
        // Each id costs a KV read plus a write; an unbounded batch would run
        // straight into the subrequest limit.
        if (ids.length > MAX_SELF_VIEW_IDS) return json({ error: `At most ${MAX_SELF_VIEW_IDS} ids per call` }, 400);
      } catch (e) {
        return json({ error: 'Invalid JSON body' }, 400);
      }

      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const cutoff = now - SELF_VIEW_WINDOW_MS;
      const results = [];
      let totalReclassified = 0;

      for (const id of ids) {
        const existing = await env.TRACKER.get(id, 'json');
        if (!existing) {
          results.push({ id, status: 'not_found' });
          continue;
        }

        let reclassified = 0;
        const keptEvents = [];
        existing.filteredEvents = existing.filteredEvents || [];

        // Reclassify recent genuine opens as self-view
        for (const event of existing.events) {
          const eventTime = new Date(event.time).getTime();
          if (eventTime >= cutoff) {
            existing.filteredEvents.push({ ...event, reason: 'self_view', reclassifiedAt: nowIso });
            reclassified++;
          } else {
            keptEvents.push(event);
          }
        }

        // Also relabel recent bot_proxy filtered events as self_view
        // (Gmail's GoogleImageProxy fires when sender opens their own thread)
        for (const event of existing.filteredEvents) {
          const eventTime = new Date(event.time).getTime();
          if (eventTime >= cutoff && event.reason === 'bot_proxy') {
            event.reason = 'self_view';
            event.reclassifiedAt = nowIso;
          }
        }

        if (reclassified > 0) {
          existing.events = keptEvents;
          existing.opens = Math.max(0, existing.opens - reclassified);
          existing.skipped = (existing.skipped || 0) + reclassified;
        }

        if (existing.filteredEvents.length > 20) existing.filteredEvents = existing.filteredEvents.slice(-20);
        await putTracker(env, id, existing);
        console.log(`[self-view] id=${id} reclassified=${reclassified} opens_now=${existing.opens}`);

        totalReclassified += reclassified;
        results.push({ id, reclassified, opensNow: existing.opens });
      }

      console.log(`[self-view] batch: ${ids.length} trackers, ${totalReclassified} total reclassified`);
      return json({ ok: true, totalReclassified, results });
    }

    // GET /t/:id — track pixel open
    if (url.pathname.startsWith('/t/')) {
      const id = url.pathname.slice('/t/'.length);
      if (!id || id.startsWith(INTERNAL_PREFIX)) return new Response('Missing id', { status: 400 });

      const existing = await env.TRACKER.get(id, 'json');
      if (!existing) return servePixel();

      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const country = request.headers.get('cf-ipcountry') || 'unknown';
      const userAgent = request.headers.get('user-agent') || 'unknown';
      const now = new Date().toISOString();
      const nowMs = new Date(now).getTime();

      // Filter 1: Sender IP exclusion
      if (existing.senderIp && existing.senderIp === ip) {
        if (isRepeatHit(existing.filteredEvents || [], ip, nowMs)) return servePixel();
        existing.skipped = (existing.skipped || 0) + 1;
        existing.filteredEvents = existing.filteredEvents || [];
        existing.filteredEvents.push({ time: now, ip, reason: 'sender_ip' });
        if (existing.filteredEvents.length > 20) existing.filteredEvents = existing.filteredEvents.slice(-20);
        await putTracker(env, id, existing);
        console.log(`[open] id=${id} SKIPPED reason=sender_ip ip=${ip}`);
        return servePixel();
      }

      // Filter 2: Bot/proxy detection
      if (isBot(userAgent)) {
        if (isRepeatHit(existing.filteredEvents || [], ip, nowMs)) return servePixel();
        existing.skipped = (existing.skipped || 0) + 1;
        existing.filteredEvents = existing.filteredEvents || [];
        existing.filteredEvents.push({ time: now, ip, userAgent, reason: 'bot_proxy' });
        if (existing.filteredEvents.length > 20) existing.filteredEvents = existing.filteredEvents.slice(-20);
        await putTracker(env, id, existing);
        console.log(`[open] id=${id} SKIPPED reason=bot_proxy ua=${userAgent}`);
        return servePixel();
      }

      // Filter 3: Dedup window (same IP within 5s)
      if (isRepeatHit(existing.events, ip, nowMs)) {
        console.log(`[open] id=${id} SKIPPED reason=dedup ip=${ip}`);
        return servePixel();
      }

      // Record the open — extension will retroactively reclassify if it was a self-view
      existing.opens += 1;
      existing.events.push({ time: now, ip, country, userAgent });
      if (existing.events.length > 100) existing.events = existing.events.slice(-100);
      await putTracker(env, id, existing);

      console.log(`[open] id=${id} RECORDED opens=${existing.opens} ip=${ip} country=${country} ua=${userAgent}`);

      // Queue the webhook under its own key. Appending to one shared key meant a
      // read-modify-write per open: KV caps writes at one per second per key, and
      // concurrent opens silently overwrote each other's entries. The TTL keeps an
      // abandoned queue from growing without bound if the cron trigger is missing.
      await Promise.all([
        env.TRACKER.put(
          `${PENDING_PREFIX}${nowMs}:${id}`,
          JSON.stringify({ id, time: now, ip, country, recipient: existing.recipient, subject: existing.subject }),
          { expirationTtl: PENDING_TTL_S },
        ),
        // KV reads are eventually consistent, so the cron may not see this for a
        // firing or two. The entry stays queued until it does, so the webhook is
        // delayed, never dropped. The TTL matches the entries it stands for.
        env.TRACKER.put(QUEUE_HINT, '1', { expirationTtl: PENDING_TTL_S }),
      ]);

      return servePixel();
    }

    // GET /s/:id — stats for a tracking pixel
    if (url.pathname.startsWith('/s/')) {
      if (!checkAuth(request, env)) return requireAuth(env);

      const id = url.pathname.slice('/s/'.length);
      if (!id || id.startsWith(INTERNAL_PREFIX)) return new Response('Missing id', { status: 400 });

      const data = await env.TRACKER.get(id, 'json');
      if (!data) return new Response('Tracker not found', { status: 404 });

      const acceptsJson = request.headers.get('accept')?.includes('application/json');
      const formatJson = url.searchParams.get('format') === 'json';

      if (acceptsJson || formatJson) {
        const { senderIp, ...safeData } = data;
        return json({ ...safeData, recipient: data.recipient || null, hasSenderProtection: !!senderIp });
      }

      const nonce = crypto.randomUUID();
      return html(renderDetail(id, data, nonce), nonce);
    }

    // POST /new — create a new tracking pixel
    if (url.pathname === '/new') {
      if (!checkAuth(request, env)) return requireAuth(env, CORS_HEADERS);
      // State changes are POST/DELETE only. A GET can be fired from any page
      // with an <img> tag, and browsers attach cached Basic credentials to it.
      if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);

      const id = crypto.randomUUID().replace(/-/g, '').slice(0, ID_LENGTH);
      const senderIp = request.headers.get('cf-connecting-ip') || 'unknown';

      let recipient = null, subject = '', bodyPreview = '', messageId = '';
      try {
        const body = await request.json();
        recipient = body.to || null;
        subject = body.subject || '';
        bodyPreview = body.bodyPreview || '';
        messageId = body.messageId || '';
      } catch (e) {
        return json({ error: 'Invalid JSON body' }, 400);
      }

      if (recipient && !recipient.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return json({ error: 'Invalid email format' }, 400);
      if (subject.length > 500 || bodyPreview.length > 1000) return json({ error: 'Input too long' }, 400);

      await putTracker(env, id, {
        opens: 0, events: [], filteredEvents: [], skipped: 0,
        senderIp, recipient, subject, bodyPreview, messageId,
        createdAt: new Date().toISOString(),
      });

      const base = url.origin;
      return json({
        id, pixel: `${base}/t/${id}`,
        html: `<img src="${base}/t/${id}" width="1" height="1" style="display:none" />`,
        stats: `${base}/s/${id}`, recipient, subject, bodyPreview,
      });
    }

    // GET /list — JSON API for extension
    if (url.pathname === '/list') {
      if (!checkAuth(request, env)) return requireAuth(env, CORS_HEADERS);

      const trackers = await listTrackers(env);
      return json(trackers.map(t => ({
        id: t.id, opens: t.opens || 0, skipped: t.skipped || 0,
        recipient: t.recipient || null, subject: t.subject || '',
        bodyPreview: t.bodyPreview || '', messageId: t.messageId || '',
        createdAt: t.createdAt || null, lastOpen: t.lastOpen || null,
      })));
    }

    // DELETE /d/:id — delete a tracking pixel
    if (url.pathname.startsWith('/d/')) {
      if (!checkAuth(request, env)) return requireAuth(env, CORS_HEADERS);
      // Was a GET: <img src="https://tracker/d/:id"> on any page deleted a
      // tracker, since the browser attached the owner's cached credentials.
      if (request.method !== 'DELETE') return json({ error: 'Use DELETE' }, 405);
      const id = url.pathname.slice('/d/'.length);
      if (!id || id.startsWith(INTERNAL_PREFIX)) return json({ error: 'Missing id' }, 400);
      await env.TRACKER.delete(id);
      return json({ deleted: id });
    }

    // GET / — dashboard
    if (url.pathname === '/') {
      if (!checkAuth(request, env)) return requireAuth(env);

      const results = (await listTrackers(env)).map(t => ({
        id: t.id, email: t.recipient || t.id,
        subject: t.subject || '', bodyPreview: t.bodyPreview || '',
        opens: t.opens || 0,
        lastOpen: t.lastOpen || 'never',
        createdAt: t.createdAt || null,
      }));

      results.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      const totalOpens = results.reduce((s, r) => s + r.opens, 0);
      const activeCount = results.filter(r => r.opens > 0).length;

      const nonce = crypto.randomUUID();
      return html(renderDashboard(results, totalOpens, activeCount, nonce), nonce);
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env) {
    // Nearly every firing finds an empty queue. Spend a read to establish that,
    // not a list — see QUEUE_HINT.
    if (!(await env.TRACKER.get(QUEUE_HINT))) return;

    const { keys } = await env.TRACKER.list({ prefix: PENDING_PREFIX, limit: MAX_PENDING_PER_RUN });
    if (!keys.length) {
      await env.TRACKER.delete(QUEUE_HINT);
      return;
    }

    const now = Date.now();

    for (const key of keys) {
      const item = await env.TRACKER.get(key.name, 'json');
      if (!item) continue;

      // Too young — leave it queued so /self still has time to reclassify it.
      if (now - new Date(item.time).getTime() < WEBHOOK_GRACE_MS) continue;

      await env.TRACKER.delete(key.name);

      const tracker = await env.TRACKER.get(item.id, 'json');
      if (!tracker) continue;

      const stillGenuine = (tracker.events || []).some(e => e.time === item.time && e.ip === item.ip);
      if (!stillGenuine) {
        console.log(`[cron] id=${item.id} open was reclassified, skipping webhook`);
        continue;
      }

      await sendWebhookNotifications(env, {
        recipient: item.recipient,
        subject: item.subject,
        opens: tracker.opens,
        country: item.country,
        ip: item.ip,
        time: item.time,
      });
      console.log(`[cron] id=${item.id} webhook sent for genuine open`);
    }
  },
};
