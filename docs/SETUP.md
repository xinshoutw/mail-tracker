# Setup Guide

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
 wrangler
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
- ** Single gray tick** - Email sent but not opened yet
- ** Double blue tick** - Email opened by recipient
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

---

Back to the [README](../README.md).
