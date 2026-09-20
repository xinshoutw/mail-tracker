// Background service worker — polls for new opens and sends notifications

const POLL_TIMEOUT_MS = 10_000; // a hung fetch would keep the service worker pinned alive

async function getServerUrl() {
  const { serverUrl, dashboardPassword } = await chrome.storage.sync.get(['serverUrl', 'dashboardPassword']);
  return { serverUrl: serverUrl || '', password: dashboardPassword || '' };
}

async function pollForOpens() {
  const { serverUrl, password } = await getServerUrl();
  if (!serverUrl) return;

  try {
    const headers = {};
    if (password) {
      headers['Authorization'] = 'Basic ' + btoa(':' + password);
    }
    // /feed is one KV read on the worker. Polling /list enumerated every tracker
    // instead, and a KV list costs one of 1000 a day on the free plan against
    // 100,000 reads — four polls an hour was 288 of that budget, doing nothing.
    const res = await fetch(`${serverUrl}/feed`, { headers, signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
    if (!res.ok) return;
    const { opens = [] } = await res.json();
    if (!opens.length) return;

    // ISO-8601 UTC timestamps are fixed width, so string order is time order.
    const latest = opens.reduce((max, open) => (open.time > max ? open.time : max), '');
    const { lastSeenOpen = null } = await chrome.storage.local.get('lastSeenOpen');

    // The feed carries history, so the first poll only sets the mark. Announcing
    // everything already in it would be a wall of stale notifications.
    if (lastSeenOpen) {
      for (const open of opens) {
        if (open.time <= lastSeenOpen) continue;
        const who = open.recipient || open.id;
        chrome.notifications.create(`open-${open.id}-${new Date(open.time).getTime()}`, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Email Opened!',
          message: `${who} opened your email — total opens: ${open.opens}`,
        });
      }
    }

    await chrome.storage.local.set({ lastSeenOpen: latest });
  } catch (e) {
    // Server unreachable — silently ignore
  }
}

// Poll on alarm
chrome.alarms.create('poll-opens', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll-opens') pollForOpens();
});

// Also poll on install/startup
chrome.runtime.onStartup.addListener(pollForOpens);
chrome.runtime.onInstalled.addListener(pollForOpens);
