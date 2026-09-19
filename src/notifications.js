// Webhook notification handlers for Slack and Discord.
//
// Timestamps go out as native Slack/Discord date tokens rather than a formatted
// string: the worker has no access to the reader's timezone, so anything it
// formats itself would always render as UTC.

const DISCORD_FIELD_LIMIT = 1024;
const REPO_URL = 'https://github.com/samrathreddy/mail-tracker';

/** Neutralise Slack mrkdwn control characters, including <!channel> pings. */
function escapeSlack(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unixSeconds(iso) {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function slackTime(iso) {
  const ts = unixSeconds(iso);
  return ts === null ? escapeSlack(iso) : `<!date^${ts}^{date_short_pretty} {time}|${ts}>`;
}

function discordTime(iso) {
  const ts = unixSeconds(iso);
  return ts === null ? iso : `<t:${ts}:f>`;
}

function fit(str, fallback) {
  const value = String(str || '').slice(0, DISCORD_FIELD_LIMIT);
  return value || fallback;
}

async function post(url, body, label) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) console.error(`${label} webhook returned ${response.status}`);
    return response.ok;
  } catch (e) {
    console.error(`${label} webhook failed:`, e.message);
    return false;
  }
}

function slackNotification(webhookUrl, data) {
  const text = [
    '📬 *Email Opened*',
    '',
    `*Recipient:* ${escapeSlack(data.recipient || 'Unknown')}`,
    `*Subject:* ${escapeSlack(data.subject || 'No subject')}`,
    `*Opens:* ${data.opens}`,
    `*Time:* ${slackTime(data.time)}`,
    '',
    `© Mail Tracker - <${REPO_URL}|GitHub>`,
  ].join('\n');

  return post(webhookUrl, { text }, 'Slack');
}

function discordNotification(webhookUrl, data) {
  const embed = {
    title: '📬 Email Opened',
    color: 0x34a853,
    fields: [
      { name: 'Recipient', value: fit(data.recipient, 'Unknown'), inline: false },
      { name: 'Subject', value: fit(data.subject, 'No subject'), inline: false },
      { name: 'Opens', value: String(data.opens), inline: true },
      { name: 'Time', value: discordTime(data.time), inline: true },
    ],
    footer: { text: '© Mail Tracker' },
    timestamp: new Date().toISOString(),
  };

  return post(webhookUrl, { embeds: [embed] }, 'Discord');
}

/**
 * Send notifications to every configured webhook.
 * @param {Object} env - Cloudflare environment holding the webhook URLs
 * @param {Object} data - Open event: recipient, subject, opens, country, ip, time (ISO)
 */
export async function sendWebhookNotifications(env, data) {
  const sends = [];
  if (env.SLACK_WEBHOOK_URL) sends.push(slackNotification(env.SLACK_WEBHOOK_URL, data));
  if (env.DISCORD_WEBHOOK_URL) sends.push(discordNotification(env.DISCORD_WEBHOOK_URL, data));

  // Each sender already swallows its own failure, so one dead webhook cannot
  // stop the other from going out.
  await Promise.all(sends);
}
