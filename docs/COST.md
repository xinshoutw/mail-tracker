# Cost Breakdown

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

---

Back to the [README](../README.md).
