<div align="center">

# Mail Tracker

[![License](https://img.shields.io/github/license/xinshoutw/mail-tracker?style=for-the-badge)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](extension)

Self-hosted email open tracking. Install in five minutes, runs free on Cloudflare.

[繁體中文](README.md) | **English**

</div>

## Overview

Mail Tracker embeds an invisible 1x1 pixel in the mail you send. When the recipient
opens it, the pixel fires a request and the open is recorded — who, when, from where.

A Chrome extension injects the pixel into Gmail on Send, one per recipient, and shows
read indicators next to sent mail. A Cloudflare Worker serves the pixel, filters the
noise, and stores everything in your own KV namespace. No third party ever sees the data.

### Features

- **Auto-tracking** — the extension injects a pixel per recipient when you press Send
- **Read indicators** — single and double ticks beside recipients in the Gmail sent list
- **Self-open filtering** — opening your own thread does not count as the recipient reading it
- **Notifications** — Chrome, Slack and Discord, sent only once an open survives filtering
- **Self-hosted** — your Cloudflare account, your KV namespace, no vendor in the middle
- **No runtime dependencies** — vanilla JavaScript, no framework, no build step

### How it works

1. You press Send in Gmail. The extension creates one tracker per recipient and drops an
   invisible `<img>` into the body.
2. The recipient opens the mail. Their client fetches the pixel from your Worker.
3. The Worker records IP, country, user agent and time, then runs three filters: sender IP,
   known scanners, and a five-second window against repeat hits.
4. The open is queued for notification rather than announced immediately.
5. If you were the one who opened the thread, the extension tells the Worker to reclassify
   it as a self-view within that window.
6. A cron trigger drains the queue a few seconds later and notifies you about what is left.

The delay in steps 4 to 6 is the point: it is what stops your own reading of a thread from
being reported as the recipient opening your mail.

## Demo

https://github.com/user-attachments/assets/5470a2ce-9076-407d-8961-1ade0ea8329f

<br/>

## Quick Start

### Requirements

- Node 20 or newer
- pnpm
- A Cloudflare account with Workers and KV enabled

### Deploy

```bash
git clone https://github.com/xinshoutw/mail-tracker.git
cd mail-tracker
pnpm install

pnpm exec wrangler kv namespace create "TRACKER"   # paste the id into wrangler.toml
pnpm exec wrangler secret put DASHBOARD_PASSWORD   # required
pnpm run deploy
```

> [!IMPORTANT]
> `DASHBOARD_PASSWORD` is not optional. Without it the Worker answers every route with
> `503` rather than leaving your recipients, subjects and opener IPs readable by anyone
> who finds the URL. The tracking endpoint `/t/:id` stays open so mail clients can load
> the pixel.

> [!IMPORTANT]
> `wrangler.toml` must declare the cron trigger. Queued notifications are drained by the
> scheduled handler, so without it no webhook is ever sent.
>
> ```toml
> [triggers]
> crons = ["* * * * *"]
> ```

### Extension

Download the zip from [Releases](https://github.com/xinshoutw/mail-tracker/releases),
unzip it, then load it at `chrome://extensions` with Developer mode on and **Load
unpacked**. Open the extension and enter your Worker URL and dashboard password.

### Local development

```bash
pnpm dev     # http://localhost:8787
pnpm test    # node --test, no extra dependencies
```

Put `DASHBOARD_PASSWORD=...` in `.dev.vars` for local runs. The file is gitignored.

<br/>

## Tech Stack

| Area | Choice |
|---|---|
| Runtime | Cloudflare Workers (V8 isolate, no Node APIs) |
| Storage | Cloudflare KV, bound as `TRACKER` |
| Scheduling | Cron trigger, one minute |
| Extension | Chrome Manifest V3, vanilla JS |
| Tests | `node:test` against an in-memory KV stub |
| Deploy | Cloudflare Workers Builds on push to `main` |
| Dependencies | None at runtime; wrangler only for builds |

### Project Structure

```
src/index.js              Worker entry: router, API handlers, cron
src/shared.js             Constants, auth, escaping, pixel, KV metadata
src/notifications.js      Slack and Discord webhook dispatch
src/views/dashboard.js    Listing page (GET /)
src/views/detail.js       Tracker page (GET /s/:id)
extension/manifest.json   Manifest V3
extension/gmail.js        Content script: inject on Send, self-view detection
extension/popup.js        Popup: tracker list, detail, settings
extension/background.js   Service worker: polls for new opens
test/worker.test.js       node --test suite
wrangler.toml             KV binding and cron trigger
```

<br/>

## API

Every route except `/t/:id` uses HTTP Basic auth. The username is ignored; only the
password matters, and it may contain colons.

| Endpoint | Auth | Description |
|---|:---:|---|
| `GET /` | Yes | Dashboard |
| `POST /new` | Yes | Create a tracker from `{ to?, subject?, bodyPreview?, messageId? }` |
| `GET /t/:id` | No | Serve the pixel and record the open |
| `GET /s/:id` | Yes | Tracker page, or stats as JSON with `?format=json` |
| `GET /list` | Yes | All trackers as JSON |
| `POST /self` | Yes | Reclassify recent opens as self-views, `{ ids: [...] }`, max 50 |
| `DELETE /d/:id` | Yes | Delete a tracker |

`/new` and `/d/:id` reject `GET` deliberately: a `GET` can be fired from any page with an
`<img>` tag, and the browser attaches the cached credentials to it.

```bash
curl -u :your-password -X POST -H 'Content-Type: application/json' \
     -d '{"to":"her@example.com","subject":"Hi"}' \
     https://your-worker.workers.dev/new

curl -u :your-password -X DELETE https://your-worker.workers.dev/d/THE_ID
```

<br/>

## Comparison

| | Mail Tracker | Mailtrack | Streak | Superhuman | HubSpot |
|---|---|---|---|---|---|
| Price | Free | $9.99/mo | $49/mo | $30/mo | $45/mo |
| Self-hosted | Yes | No | No | No | No |
| Open source | AGPL-3.0 | No | No | No | No |
| No data collection | Yes | No | No | No | No |
| Read indicators | Yes | Yes | Yes | Yes | No |
| Slack and Discord | Yes | No | No | No | Yes |
| Self-open filtering | Yes | Partial | Partial | Yes | Yes |

<br/>

## Limitations

Pixel tracking is inference, not certainty. It fails in ways worth knowing before you
rely on it:

- **Images disabled** — no pixel load, no signal. Common in corporate Outlook.
- **Apple Mail Privacy Protection** — iOS 15 and later pre-fetch every image through
  Apple's proxy, so an open is recorded with Apple's IP rather than the reader's.
- **Gmail image caching** — Gmail may serve a cached copy, so later opens by the same
  person can go unrecorded.
- **Self-open filtering needs the extension** — reading a tracked thread outside Gmail,
  or without the extension installed, can register as a genuine open.
- **Plain text** — Gmail's plain text compose mode strips the `<img>`, as does any client
  that sends plain text only. Gmail sends HTML by default, so this only bites if you
  switch it on.

<br/>

## Documentation

| File | Contents |
|---|---|
| [`docs/SETUP.md`](docs/SETUP.md) | Full deployment walkthrough, extension install, usage |
| [`docs/COST.md`](docs/COST.md) | Cloudflare free tier limits and real-world cost estimates |
| [`PASSWORD_SETUP.md`](PASSWORD_SETUP.md) | The three ways to set the dashboard password |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to propose changes |
| [`CLAUDE.md`](CLAUDE.md) | Architecture notes and conventions for contributors and agents |

### Deployment and CI

| Pipeline | Runs on | Trigger |
|---|---|---|
| Worker deploy | Cloudflare Workers Builds | push to `main` |
| Tests and build check | GitHub Actions, `ci.yml` | push, pull request, manual |
| Extension release | GitHub Actions, `release-extension.yml` | pushing a `v*` tag |

Releasing the extension means bumping `extension/manifest.json` and pushing a matching
tag. The job refuses to publish when the two disagree.

```bash
git tag v1.2.0 && git push origin main v1.2.0
```

<br/>

## Contributing

Issues and pull requests are welcome. Run `pnpm test` before opening one; CI runs the
same suite plus a dry-run build of the Worker.

## License

[AGPL-3.0](LICENSE). Section 13 applies to network use: deploy a modified copy where
other people can reach it and you have to offer them its source.
