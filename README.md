<div align="center">
  <img src="extension/icons/icon128.png" alt="Mail Tracker Logo" width="128" height="128">
  
  # Mail Tracker

  ### Know when your emails are opened — automatically, privately, and for free.

  [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)
  [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
  [![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green)](https://developer.chrome.com/docs/extensions/)
  
  **⚡ Install in 5 minutes** | Self-hosted | 100% Free
</div>

---

A lightweight email open tracking system with WhatsApp-style read receipts for Gmail. Built with Cloudflare Workers (serverless backend) + Chrome extension (auto-tracking)

---

## ✨ Features

- **🚀 Auto-tracking** — Invisible pixel injected automatically when you send Gmail emails
- **✓✓ WhatsApp-style read indicators** — See ✓ (sent) and ✓✓ (read) next to recipients in Gmail
- **🔔 Real-time notifications** — Chrome notifications + Slack/Discord webhooks when emails are opened
- **🛡️ Privacy-first** — Self-hosted on your Cloudflare account, your data stays yours
- **🤖 Smart filtering** — Excludes bot proxies, and automatically detects & filters your own opens via the extension
- **💰 100% free** — Runs on Cloudflare's generous free tier (100k requests/day)
- **📊 Detailed analytics** — IP, country, device, timestamp for every open

---

## 🎬 Demo



https://github.com/user-attachments/assets/5470a2ce-9076-407d-8961-1ade0ea8329f



---

## 🚀 Quick Start

### Prerequisites

- Node.js v18+ ([install](https://nodejs.org/))
- Free Cloudflare account ([sign up](https://dash.cloudflare.com/sign-up))
- Chrome browser
- Gmail account

### Installation (5 minutes)

**1. Clone and deploy backend:**

```bash
git clone https://github.com/samrathreddy/mail-tracker.git
cd mail-tracker
pnpm install
pnpm exec wrangler login
pnpm exec wrangler kv namespace create "TRACKER"
# Copy the KV namespace ID from output
cp wrangler.example.toml wrangler.toml
# Edit wrangler.toml and paste your KV namespace ID
pnpm run deploy
# Save your worker URL: https://mail-tracker.YOUR-SUBDOMAIN.workers.dev
```

**2. Set password (optional but recommended):**

```bash
pnpm exec wrangler secret put DASHBOARD_PASSWORD
# Enter a secure password when prompted
```

**3. Install Chrome extension:**

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select `extension/` folder
4. Click the extension icon → enter your worker URL and password → **Save & Connect**

**4. Done!** Send a Gmail email and watch the magic happen ✨

---

## 📖 How It Works

```
┌─────────────┐
│ You compose │
│ Gmail email │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────┐
│ Extension auto-injects      │
│ invisible 1x1 tracking pixel│
│ per recipient               │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ Recipient opens email       │
│ → pixel loads               │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ Cloudflare Worker logs:     │
│ • IP, country, device       │
│ • Timestamp                 │
│ • Filters bots & duplicates │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ Self-open detection:        │
│ • Extension detects pixel   │
│   in thread DOM             │
│ • Tells worker to reclassify│
│   open as "self-view"       │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ Cron (every 1 min) checks:  │
│ • Open still genuine?       │
│   → Send Slack/Discord/     │
│     Chrome notification     │
│ • Open was self-view?       │
│   → Skip silently           │
└─────────────────────────────┘
```

---

## 🎯 Use Cases

- **Sales & outreach** — Know when prospects open your cold emails
- **Job applications** — See if recruiters opened your application
- **Customer support** — Confirm customers received your response
- **Personal** — Check if friends/family read your important emails
- **Freelancers** — Track proposal and invoice opens

---

## 🆚 Why Mail Tracker?

| Feature | Mail Tracker | Mailtrack | Streak | Superhuman | HubSpot |
|---------|:------------:|:---------:|:------:|:----------:|:-------:|
| **Price** | **Free forever** | $9.99/mo | $49/mo | $30/mo | $45/mo |
| **Self-hosted** | ✅ Your infra | ❌ Cloud | ❌ Cloud | ❌ Cloud | ❌ Cloud |
| **Open source** | ✅ AGPL-3.0 | ❌ | ❌ | ❌ | ❌ |
| **No data collection** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Auto-tracking** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Read indicators** | ✅ WhatsApp-style | ✅ | ✅ | ✅ | ❌ |
| **Slack/Discord webhooks** | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Bot filtering** | ✅ | ✅ Limited | ✅ Limited | ✅ | ✅ |
| **Zero infrastructure** | ✅ CF free tier | N/A | N/A | N/A | N/A |

---

## 📚 Full Documentation

### Part 1: Deploy the Backend (Cloudflare Worker)

#### Step 1 — Clone and install

```bash
cd ~/mail-tracker
pnpm install
```

You should see wrangler installed in `node_modules/`.

#### Step 2 — Log in to Cloudflare

```bash
pnpm exec wrangler login
```

This opens your browser. Log in to your Cloudflare account and authorize Wrangler.

To verify it worked:
```bash
pnpm exec wrangler whoami
```
You should see your account name and ID.

#### Step 3 — Create a KV namespace

KV is Cloudflare's key-value database. The worker uses it to store tracking data.

```bash
pnpm exec wrangler kv namespace create "TRACKER"
```

You'll see output like:
```
⛅️ wrangler
{ binding = "TRACKER", id = "abc123def456..." }
```

**Copy that `id` value.** You'll need it in the next step.

#### Step 4 — Configure wrangler.toml

Copy the example config and paste your KV namespace ID:

```bash
cp wrangler.example.toml wrangler.toml
```

Then open `wrangler.toml` and replace the placeholder `id`:

```toml
name = "mail-tracker"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "TRACKER"
id = "abc123def456..."   # ← paste YOUR id here
```

> Note: `wrangler.toml` is gitignored since it contains your KV namespace ID. The repo ships `wrangler.example.toml` as a template.

#### Step 5 — Test locally (optional)

```bash
pnpm dev
```

Open [http://localhost:8787](http://localhost:8787) in your browser. You should see the Mail Tracker dashboard. Press `Ctrl+C` to stop.

#### Step 6 — Deploy to Cloudflare

```bash
pnpm run deploy
```

Output will show your live URL:
```
Published mail-tracker (1.2s)
  https://mail-tracker.YOUR-SUBDOMAIN.workers.dev
```

**Save this URL** — you'll enter it in the extension settings.

#### Step 7 — Set Dashboard Password (Required)

The worker refuses every route until this is set, rather than leaving your
recipients, subjects and opener IPs readable by anyone who finds the URL:

```bash
pnpm exec wrangler secret put DASHBOARD_PASSWORD
```

When prompted, enter a secure password. This password will be required to:
- Access the web dashboard
- Use the Chrome extension
- View tracking stats

**Note:** Secrets are stored encrypted in Cloudflare, not in `.env` or `wrangler.toml`. The `.env.example` file is just a template for reference.

**Important:** The tracking pixel endpoint (`/t/:id`) remains open so emails can load properly.

A password containing `:` is fine. If `DASHBOARD_PASSWORD` is missing the worker
answers `503` with a reminder instead of serving the dashboard.

To verify: open `https://mail-tracker.YOUR-SUBDOMAIN.workers.dev` in your browser. You should be prompted for a password. Enter any username (it's ignored) and the password you just set.

#### Step 8 — Set Up Webhook Notifications (Optional)

Get real-time notifications on Slack or Discord when emails are opened:

**For Slack:**
1. Go to https://api.slack.com/messaging/webhooks
2. Create a new webhook for your workspace
3. Copy the webhook URL
4. Run: `pnpm exec wrangler secret put SLACK_WEBHOOK_URL`
5. Paste your webhook URL when prompted

**For Discord:**
1. Open your Discord server settings → Integrations → Webhooks
2. Click "New Webhook"
3. Copy the webhook URL
4. Run: `pnpm exec wrangler secret put DISCORD_WEBHOOK_URL`
5. Paste your webhook URL when prompted

Notifications need the `[triggers]` cron block from `wrangler.example.toml` in
your `wrangler.toml`. Without it the scheduled handler never runs and no webhook
is ever sent. Delivery is within ~1 minute of a genuine open. Self-opens are automatically filtered out — you'll never get notified for opening your own emails.

---

### Part 2: Install the Chrome Extension

#### Step 1 — Open Chrome extensions page

Navigate to:
```
chrome://extensions
```

#### Step 2 — Enable Developer Mode

Toggle **Developer mode** ON (top-right corner of the page).

#### Step 3 — Load the extension

1. Click **Load unpacked**
2. Navigate to and select the `extension/` folder inside your project:
   ```
   ~/mail-tracker/extension/
   ```
3. The extension should appear in your extensions list

#### Step 4 — Pin the extension

Click the **puzzle piece icon** (Extensions) in Chrome's toolbar, then click the **pin icon** next to "Mail Tracker" so it's always visible.

#### Step 5 — Connect to your Worker

1. Click the **Mail Tracker icon** in the toolbar
2. You'll see the Settings screen asking for a server URL
3. Enter your Worker URL from Part 1:
   ```
   https://mail-tracker.YOUR-SUBDOMAIN.workers.dev
   ```
4. If you set a password in Part 1, Step 7, enter it in the **Dashboard password** field
5. Click **Save & Connect**
6. If it says "Connected!" — you're done!

**Note:** If you didn't set a password, leave the password field empty.

---

### Part 3: Usage

#### Automatic Gmail Tracking (default: ON)

Just use Gmail normally:

1. Open [Gmail](https://mail.google.com) and compose an email
2. Write your email and click **Send**
3. The extension automatically:
   - Reads the To/CC/BCC recipients
   - Creates a tracking pixel for each recipient
   - Injects the invisible pixel into the email body
   - Lets the email send normally
4. When a recipient opens the email, you'll get a Chrome notification:
   > "bob@example.com opened your email"

**WhatsApp-Style Read Indicators:**
- **✓ Single gray tick** - Email sent but not opened yet
- **✓✓ Double blue tick** - Email opened by recipient
- **Hover tooltips** show "Opened X times, Last opened: timestamp"
- **Appears in Gmail sent folder** next to recipient names

You can click the extension icon anytime to see:
- All tracked emails with recipient names
- Open counts and timestamps
- Detailed event logs (IP, country, device)

#### Manual Tracker Creation

For non-Gmail use (other email clients, websites, etc.):

1. Click the extension icon
2. Click **+ Manual**
3. Click a tracker to see its detail view
4. Click the **HTML Snippet** or **Tracking URL** box to copy it
5. Paste into your email HTML or webpage

#### Toggle Auto-Tracking

1. Click the extension icon
2. Click the **gear icon** (Settings)
3. Toggle **Auto-track Gmail** on or off

#### Tracking Protection

Your own opens are automatically filtered through multiple layers:
- **Self-view detection** — When you open a sent email, the extension detects the tracking pixel in the thread DOM and tells the worker to reclassify that open as a self-view. Works regardless of IP, VPN, or network changes.
- **Sender IP exclusion** — Fallback filter: your IP at pixel creation time is stored. Opens from that IP are filtered.
- **Bot filtering** — Outlook SafeLinks, Yahoo proxy, and other email prefetchers are detected and excluded.
- **Dedup window** — duplicate loads within 5 seconds (preview panes, double-loads) are ignored.
- **Deferred notifications** — Slack/Discord webhooks are queued and only sent after the self-view window passes (~10s), so you never get notified for your own opens.

In the extension, you'll see:
- **Real Opens** — genuine recipient opens only
- **Filtered** — count of blocked hits (your own opens + bots)
- **Sender Protection** — shows "Active" per tracker

---

## API Reference

All endpoints return JSON except `/` (HTML dashboard) and `/t/:id` (serves PNG image).

### Authentication

`DASHBOARD_PASSWORD` is required. Every endpoint except `/t/:id` uses HTTP Basic
Authentication; without the secret set, the worker refuses all of them with a
`503` rather than serving them unprotected.

```bash
# Example with curl
curl -u :your-password https://mail-tracker.YOUR-SUBDOMAIN.workers.dev/list
```

The username is ignored (can be empty). Only the password matters, and it may
contain colons.

**Note:** The tracking pixel endpoint (`/t/:id`) is always open so emails can load the image.

### Endpoints

| Endpoint | Auth Required | Description |
|----------|:-------------:|-------------|
| `GET /` | ✓ | Web dashboard with all pixels |
| `POST /new` | ✓ | Create a tracker from `{ to?, subject?, bodyPreview?, messageId? }`. Returns `{ id, pixel, html, stats }` |
| `GET /t/:id` | ✗ | Tracking endpoint — serves 1x1 PNG and records the open |
| `GET /s/:id` | ✓ | Stats for a tracker — returns `{ opens, events[], recipient, skipped, filteredEvents[], hasSenderProtection }` |
| `GET /list` | ✓ | List all pixels — returns `[{ id, opens, skipped, recipient, subject, bodyPreview, messageId, createdAt, lastOpen }]` |
| `POST /self` | ✓ | Self-view signal — extension sends `{ ids: [...] }` (max 50) to reclassify recent opens as self-views |
| `DELETE /d/:id` | ✓ | Delete a tracker — returns `{ deleted: id }` |

`/new` and `/d/:id` deliberately reject `GET`. A `GET` can be fired from any page
with an `<img>` tag, and the browser attaches the cached Basic credentials to it.

```bash
# Create a tracker for a recipient
curl -u :your-password -X POST -H 'Content-Type: application/json' \
     -d '{"to":"her@example.com","subject":"Hi"}' \
     https://mail-tracker.YOUR-SUBDOMAIN.workers.dev/new

# Delete one
curl -u :your-password -X DELETE \
     https://mail-tracker.YOUR-SUBDOMAIN.workers.dev/d/THE_ID
```

---

## Project Structure

```
mail-tracker/
├── src/
│   ├── index.js           # Worker entry — router, API handlers, cron
│   ├── shared.js          # Constants, helpers, auth, pixel serving
│   ├── notifications.js   # Slack/Discord webhook dispatch
│   └── views/
│       ├── dashboard.js   # Main listing page (GET /)
│       └── detail.js      # Individual tracker page (GET /s/:id)
├── extension/
│   ├── manifest.json      # Chrome extension manifest (v3)
│   ├── popup.html         # Extension popup UI
│   ├── popup.js           # Popup logic
│   ├── background.js      # Service worker (polling & notifications)
│   ├── gmail.js           # Content script (auto-inject + self-view detection)
│   └── icons/             # Extension icons (16/48/128px)
├── wrangler.toml          # Cloudflare Workers config (KV + cron trigger)
├── CLAUDE.md              # AI assistant project guide
├── package.json
├── pnpm-lock.yaml
└── .gitignore
```

## Pricing & Cost Breakdown

This project runs on Cloudflare's **free tier**. For most users, you'll never pay a cent.

### Free Tier Limits

| Resource | Free Limit | Resets |
|----------|-----------|--------|
| **Worker requests** | 100,000 / day | Daily (UTC midnight) |
| **CPU time** | 10ms / request | Per request |
| **KV reads** | 100,000 / day | Daily |
| **KV writes** | 1,000 / day | Daily |
| **KV deletes** | 1,000 / day | Daily |
| **KV list operations** | 1,000 / day | Daily |
| **KV storage** | 1 GB total | — |

### What Our App Uses Per Action

| Action | Worker Requests | KV Reads | KV Writes |
|--------|:-:|:-:|:-:|
| **Send email** (create tracker) | 1 | 0 | 1 |
| **Recipient opens email** | 1 | 1 | 2 (tracker + webhook queue) |
| **Self-view detected** | 1 | 1 | 1 |
| **Cron processes webhooks** (every 1 min) | 1 | 1 | 0–1 |
| **Extension polls /list** (every 60s) | 1 | N (one per tracker) | 0 |
| **View tracker stats** | 1 | 1 | 0 |
| **Delete tracker** | 1 | 0 | 0 (1 delete) |
| **Load web dashboard** | 1 | N (one per tracker) | 0 |

### Real-World Cost Estimates

**Scenario 1: Personal use (free)**
- Send ~20 tracked emails/day
- ~50 opens/day
- Cron trigger: ~1,440 requests/day (once per minute, 0 writes when idle)
- **Total: ~1,510 requests/day, ~120 KV writes/day**
- Well within free tier. **Cost: $0/month**

**Scenario 2: Heavy personal use (free)**
- Send ~100 tracked emails/day
- ~500 opens/day
- 200 pixels stored, extension polling reads ~200 keys per poll
- **Total: ~290,000 KV reads/day, ~800 KV writes/day**
- Still within free tier. **Cost: $0/month**

**Scenario 3: Team / power user (paid plan needed)**
- Send ~1,000+ tracked emails/day
- ~5,000+ opens/day
- Would exceed the 1,000 KV writes/day free limit
- Paid plan: **$5/month base** includes 1M KV writes/month and 10M reads/month
- That covers ~33,000 emails/day and ~330,000 opens/day
- **Cost: $5/month** (covers almost any individual or small team)

### Paid Plan Overage Rates (if you exceed included)

| Resource | Included (Paid) | Overage Cost |
|----------|-----------------|-------------|
| Worker requests | 10M / month | +$0.30 / million |
| KV reads | 10M / month | +$0.50 / million |
| KV writes | 1M / month | +$5.00 / million |
| KV deletes | 1M / month | +$5.00 / million |
| KV list ops | 1M / month | +$5.00 / million |
| KV storage | 1 GB | +$0.50 / GB-month |

### Storage Estimate

Each tracker uses ~0.5–2 KB of KV storage (depending on number of events stored, max 100 events per tracker).

| Emails tracked | Approximate storage |
|:-:|:-:|
| 100 | ~100 KB |
| 1,000 | ~1 MB |
| 10,000 | ~10 MB |
| 100,000 | ~100 MB |

You'd need to track **500,000+ trackers** to approach the 1 GB free storage limit.

### TL;DR

| Usage Level | Monthly Cost |
|------------|:--:|
| Personal (up to ~100 emails/day) | **Free** |
| Heavy personal (up to ~1,000 emails/day) | **Free** (close to limit) |
| Team / power user | **$5/month** |
| Enterprise scale | **$5 + overages** |

> Source: [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/)

---

## Limitations

- **Images disabled** — if the recipient's email client blocks images by default, the pixel won't load (common in corporate Outlook)
- **Apple Mail Privacy Protection** (iOS 15+) — pre-fetches all images through Apple's proxy, so you see an open but with Apple's IP, not the recipient's real location
- **Gmail image caching** — Gmail sometimes caches images after the first load, so subsequent opens from the same person may not trigger
- **Extension required for self-open filtering** — self-view detection relies on the Chrome extension detecting the pixel in your Gmail DOM. If you open tracked emails outside Gmail (e.g. forwarded, in another client) without the extension, it may count as a real open
- **Gmail plain text mode** — if you toggle "Plain text mode" in Gmail's compose menu (three dots → Plain text mode), all HTML is stripped and tracking won't work. This is **off by default** — Gmail always sends HTML, so even a simple "hi" email will include the tracking pixel. Just don't switch to plain text mode.
- **Plain text emails (other clients)** — if you use a non-Gmail client that sends plain text only, tracking won't work since the `<img>` tag gets stripped

## Testing

```bash
pnpm test        # node --test, no extra dependencies
```

---

## License

[AGPL-3.0](LICENSE)

Note that AGPL section 13 applies to network use: if you deploy a modified copy
where other people can reach it, you have to offer them its source.

Free to use, share, modify, and contribute. If you modify and deploy it as a service, you must release your source code under the same license.
