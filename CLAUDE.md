# Mail Tracker - Project Guide

## Overview

Email open tracking service. Embeds a 1x1 transparent PNG pixel in emails — when the recipient opens the email, the pixel fires a request that records the open. Built with a Cloudflare Worker backend and Chrome extension frontend.

## Architecture

```
mail-tracker/
├── src/
│   ├── index.js            # Worker entry — router & API handlers
│   ├── shared.js           # Constants, helpers, auth, pixel serving
│   ├── notifications.js    # Slack/Discord webhook dispatch
│   └── views/
│       ├── dashboard.js    # Main listing page (GET /)
│       └── detail.js       # Individual tracker page (GET /s/:id)
├── test/
│   └── worker.test.js      # node --test, in-memory KV stub
├── extension/              # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── popup.html / popup.js
│   ├── background.js       # Service worker — polling & notifications
│   ├── gmail.js            # Content script — auto-injects pixel on Send
│   └── icons/
├── wrangler.toml           # Cloudflare Workers config (KV binding)
└── package.json
```

## Tech Stack

- **Runtime**: Cloudflare Workers (V8 isolate, no Node.js APIs)
- **Storage**: Cloudflare KV (bound as `TRACKER`)
- **Frontend**: Chrome Extension (Manifest V3), vanilla JS
- **Package manager**: pnpm
- **No frameworks, no build step, no npm runtime deps**

## Commands

- `pnpm dev` — local dev server at http://localhost:8787
- `pnpm test` — `node --test` against an in-memory KV stub, no extra deps
- `pnpm run deploy` — deploy to Cloudflare (note: `pnpm run deploy`, not `pnpm deploy`)

## API Endpoints

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/` | GET | Yes | Web dashboard — lists all trackers |
| `/t/:id` | GET | No | Serve tracking pixel & record open |
| `/s/:id` | GET | Yes | Tracker detail page (HTML) or stats (JSON with `?format=json`) |
| `/new` | POST | Yes | Create new pixel from `{ to, subject, bodyPreview, messageId }` |
| `/list` | GET | Yes | List all pixels as JSON (used by extension) |
| `/self` | POST | Yes | Reclassify recent opens as self-views, `{ ids: [...] }`, max 50 |
| `/d/:id` | DELETE | Yes | Delete a pixel |

State-changing routes reject GET on purpose: a GET can be fired cross-site from
an `<img>` tag, which carries the browser's cached Basic credentials.

Auth uses HTTP Basic with the `DASHBOARD_PASSWORD` secret, compared in constant
time and split on the first colon only. **If unset, every route is refused with
a 503** — the worker never runs unprotected.

The `scheduled()` handler drains queued webhooks and needs the `[triggers]` cron
block in `wrangler.toml`. Without it, no notification is ever sent.

It fires 1,440 times a day, so it rules out an empty queue by reading the
`__queued__` hint and only calls `list()` when something is actually queued. The
free plan meters 100,000 reads a day against only 1,000 lists: listing on every
firing was 1,440 lists a day at rest, over the daily limit before a single email
was tracked, and it took `/` and `/list` down with it because those list() too.
**Do not remove the hint check to simplify the handler.**

## Storage Schema

Each pixel in KV (key = 16 hex chars from a UUID; it was 8, which is only
32 bits and collided silently):
```json
{
  "opens": 5,
  "skipped": 2,
  "senderIp": "...",
  "recipient": "user@example.com",
  "subject": "...",
  "bodyPreview": "...",
  "messageId": "...",
  "createdAt": "ISO-8601",
  "events": [
    { "time": "ISO-8601", "ip": "...", "country": "US", "userAgent": "..." }
  ],
  "filteredEvents": [
    { "time": "ISO-8601", "ip": "...", "reason": "sender_ip|bot_proxy" }
  ]
}
```
- `events` capped at 100, `filteredEvents` capped at 20
- Every tracker write goes through `putTracker()`, which attaches a KV metadata
  summary. `/` and `/list` render from `list()` metadata alone — a `get()` per
  key blew the Workers subrequest limit at ~50 trackers. Omitting metadata on a
  `put` clears it, so never call `TRACKER.put` on a tracker directly.
- Worker-owned keys use the `__` prefix (`__pending__:<ms>:<id>` for queued
  webhooks, one key per open with a TTL; `__queued__` as the "queue is not
  empty" hint). Listings and routes must skip them.

## Open Filtering Pipeline

Three filters run before recording an open:
1. **Sender IP** — skips if opener IP matches creator IP
2. **Bot detection** — regex patterns for true scanners only (SafeLinks, SMTP
   STS, Slurp, Office prefetch)
3. **Dedup window** — ignores same-IP opens within 5 seconds

**Do not add mail provider image proxies to `BOT_PATTERNS`.** Gmail and Yahoo
Mail fetch every image through their own proxy, so that request *is* the
recipient's open and the only signal this service gets. Filtering
`GoogleImageProxy` and `66.249.0.0/16` once meant every Gmail recipient recorded
zero opens. The sender's own views are handled by the sender-IP filter and by
`POST /self`, which reclassifies an open when the extension sees the sender open
their own thread.

## Code Conventions

### General
- No frameworks or build tools — vanilla JS everywhere
- Keep modules focused: router logic in `index.js`, HTML generation in `views/`, reusable bits in `shared.js`
- All timezone-dependent computations (hourly chart, calendar heatmap) happen **client-side** so they match the viewer's local time
- Webhook notifications are dispatched in `notifications.js`

### Security
- Use DOM APIs (`createElement`, `textContent`) — never `innerHTML` with dynamic data
- Escape all server-injected strings in HTML templates with `esc()` from `shared.js`
- **Inside an inline `<script>`, use `jsonForScript()`, never bare
  `JSON.stringify`.** `JSON.stringify` leaves `<` alone, so a value containing
  `</script>` closes the block and runs as markup. `/t/:id` is unauthenticated
  and stores the raw `User-Agent`, so this was a stored XSS any recipient of a
  tracked mail could fire at the owner's dashboard.
- Both HTML pages are served under a per-request nonce CSP; keep each page to a
  single inline `<script nonce="${nonce}">`
- All API responses include CORS headers for extension compatibility
- Validate inputs at API boundaries (email format, string length limits)

### UI
- Dark theme (zinc/indigo/emerald palette) across dashboard and extension
- Inline SVG favicon and logo — no external asset dependencies
- Dashboard features: search/filter, card-based list, create modal
- Detail page features: stats grid, calendar heatmap, peak hours grid, event timeline with tabs

### Extension
- Gmail content script (`gmail.js`) hooks Send button to auto-inject tracking pixels
- Per-recipient tracking: each recipient gets their own pixel ID
- Background service worker polls for new opens

## Deployment

- The worker deploys through **Cloudflare Workers Builds** on push to `main`,
  not from GitHub Actions. `wrangler.toml` is committed because Workers Builds
  reads the config out of the repository.
- Secrets live only in the Cloudflare dashboard. Saving one there creates a new
  version but does **not** roll it out — the Deploy button still has to be
  pressed, otherwise the worker keeps serving the previous version without it.
- Workers cannot be renamed. Changing `name` in `wrangler.toml` deploys a second
  script and leaves the old one, its secrets and its Builds connection behind.
- `.github/workflows/ci.yml` runs the suite and a `--dry-run` build on every
  push and pull request. `release-extension.yml` packages `extension/` when a
  `v*` tag is pushed, and fails if the tag and `manifest.json` disagree.

## Setup

1. Cloudflare account with Workers + KV enabled
2. Set KV namespace ID in `wrangler.toml`
3. `pnpm install` then `pnpm run deploy`
4. Optionally set `DASHBOARD_PASSWORD` secret: `npx wrangler secret put DASHBOARD_PASSWORD`
5. Optionally set `SLACK_WEBHOOK_URL` / `DISCORD_WEBHOOK_URL` for notifications
6. Load `extension/` as unpacked extension in Chrome
