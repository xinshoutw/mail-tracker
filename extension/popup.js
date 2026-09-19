// --- State ---
let serverUrl = '';
let dashboardPassword = '';
let currentPixelId = null;
let authFailed = false; // Track if last auth failed

// --- DOM refs ---
const listView = document.getElementById('list-view');
const detailView = document.getElementById('detail-view');
const setupView = document.getElementById('setup-view');
const pixelContainer = document.getElementById('pixel-container');
const toastEl = document.getElementById('toast');

// --- Sanitization ---
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  const { serverUrl: saved, dashboardPassword: savedPass, authFailed: savedAuthFailed } = await chrome.storage.sync.get(['serverUrl', 'dashboardPassword', 'authFailed']);
  serverUrl = saved || '';
  dashboardPassword = savedPass || '';
  authFailed = savedAuthFailed || false;

  if (!serverUrl || !dashboardPassword || authFailed) {
    showSetup(true);
  } else {
    loadPixels();
  }

  // Event listeners
  document.getElementById('new-btn').addEventListener('click', createPixel);
  document.getElementById('settings-btn').addEventListener('click', () => showSetup(false));
  document.getElementById('back-btn').addEventListener('click', showList);
  document.getElementById('setup-back-btn').addEventListener('click', () => {
    if (serverUrl) {
      setupView.style.display = 'none';
      listView.style.display = 'block';
    }
  });
  document.getElementById('save-btn').addEventListener('click', saveSettings);
  document.getElementById('delete-btn').addEventListener('click', deleteCurrentPixel);

  // Password visibility toggle
  const togglePwBtn = document.getElementById('toggle-password');
  const pwInput = document.getElementById('password-input');
  function makeEyeSvg(open) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    if (open) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z');
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '3');
      svg.appendChild(p); svg.appendChild(c);
    } else {
      const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p1.setAttribute('d', 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94');
      const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p2.setAttribute('d', 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19');
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', '1'); l.setAttribute('y1', '1'); l.setAttribute('x2', '23'); l.setAttribute('y2', '23');
      svg.appendChild(p1); svg.appendChild(p2); svg.appendChild(l);
    }
    return svg;
  }
  togglePwBtn.addEventListener('click', () => {
    const isPassword = pwInput.type === 'password';
    pwInput.type = isPassword ? 'text' : 'password';
    togglePwBtn.replaceChildren(makeEyeSvg(!isPassword));
    togglePwBtn.title = isPassword ? 'Hide password' : 'Show password';
  });

  document.getElementById('snippet-html').addEventListener('click', () => {
    copyToClipboard(document.getElementById('snippet-html').dataset.value);
  });
  document.getElementById('snippet-url').addEventListener('click', () => {
    copyToClipboard(document.getElementById('snippet-url').dataset.value);
  });
});

// --- API helpers ---
async function api(path, options = {}) {
  const headers = {
    'Accept': 'application/json',
    ...(options.headers || {}),
  };
  if (dashboardPassword) {
    headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
  
  try {
    const res = await fetch(`${serverUrl}${path}`, {
      ...options,
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (res.status === 401) {
      // Authentication failed - clear stored password and show setup
      authFailed = true;
      dashboardPassword = ''; // Clear in memory
      await chrome.storage.sync.set({ authFailed: true, dashboardPassword: '' });
      showSetup(false);
      throw new Error('Authentication required');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - check your password');
    }
    throw err;
  }
}

// --- Views ---
async function showSetup(isFirst) {
  setupView.style.display = 'block';
  listView.style.display = 'none';
  detailView.classList.remove('active');
  document.getElementById('setup-header').style.display = isFirst ? 'none' : 'flex';
  
  const serverInput = document.getElementById('server-input');
  const passwordInput = document.getElementById('password-input');
  
  // Restore from temporary storage (persists across popup closes)
  const { tempServerUrl, tempPassword } = await chrome.storage.local.get(['tempServerUrl', 'tempPassword']);
  
  serverInput.value = tempServerUrl || serverUrl;
  passwordInput.value = tempPassword || dashboardPassword;
  
  // Save to temp storage on blur (when field loses focus)
  serverInput.onblur = () => chrome.storage.local.set({ tempServerUrl: serverInput.value });
  passwordInput.onblur = () => chrome.storage.local.set({ tempPassword: passwordInput.value });
}

function showList() {
  listView.style.display = 'block';
  detailView.classList.remove('active');
  setupView.style.display = 'none';
  currentPixelId = null;
  loadPixels();
}

async function showDetail(id) {
  currentPixelId = id;
  listView.style.display = 'none';
  detailView.classList.add('active');

  document.getElementById('detail-id').textContent = id;
  document.getElementById('detail-recipient').textContent = '';
  document.getElementById('detail-opens').textContent = '...';
  document.getElementById('detail-last').textContent = '...';

  const eventsListEl = document.getElementById('events-list');
  eventsListEl.textContent = '';
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'loading';
  const spinnerDiv = document.createElement('div');
  spinnerDiv.className = 'spinner';
  loadingDiv.appendChild(spinnerDiv);
  eventsListEl.appendChild(loadingDiv);

  const pixelUrl = `${serverUrl}/t/${id}`;
  const htmlSnippet = `<img src="${pixelUrl}" width="1" height="1" style="display:none" />`;

  const snippetHtml = document.getElementById('snippet-html');
  const snippetUrl = document.getElementById('snippet-url');
  snippetHtml.dataset.value = htmlSnippet;
  snippetHtml.textContent = htmlSnippet;
  snippetUrl.dataset.value = pixelUrl;
  snippetUrl.textContent = pixelUrl;

  try {
    const data = await api(`/s/${id}`);
    document.getElementById('detail-recipient').textContent =
      data.recipient ? `To: ${data.recipient}` : '';
    document.getElementById('detail-opens').textContent = data.opens;
    document.getElementById('detail-skipped').textContent = data.skipped || 0;
    document.getElementById('detail-protection').textContent =
      data.hasSenderProtection ? 'Active' : 'Off';
    document.getElementById('detail-last').textContent = data.events.length
      ? timeAgo(data.events[data.events.length - 1].time)
      : 'Never';

    const recentEvents = (data.events || []).slice().reverse().slice(0, 20);
    const filteredEvents = (data.filteredEvents || []).slice().reverse().slice(0, 20);
    const filteredListEl = document.getElementById('filtered-list');

    eventsListEl.textContent = '';
    filteredListEl.textContent = '';

    renderEventList(eventsListEl, recentEvents, false);
    renderEventList(filteredListEl, filteredEvents, true);

    // Tab switching
    document.querySelectorAll('.event-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.event-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const isFiltered = tab.dataset.tab === 'filtered';
        eventsListEl.style.display = isFiltered ? 'none' : 'block';
        filteredListEl.style.display = isFiltered ? 'block' : 'none';
      });
    });
  } catch (err) {
    eventsListEl.textContent = '';
    const errDiv = document.createElement('div');
    errDiv.style.color = '#ef4444';
    errDiv.textContent = `Failed to load: ${err.message}`;
    eventsListEl.appendChild(errDiv);
  }
}

// --- Actions ---
async function loadPixels() {
  pixelContainer.textContent = '';
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'loading';
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  loadingDiv.appendChild(spinner);
  loadingDiv.appendChild(document.createTextNode('Loading...'));
  pixelContainer.appendChild(loadingDiv);

  try {
    const pixels = await api('/list');
    pixelContainer.textContent = '';

    if (pixels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      const icon = document.createElement('div');
      icon.style.fontSize = '24px';
      icon.textContent = '\u25CB';
      const text = document.createElement('p');
      text.textContent = 'No tracked emails yet. Click + New to create one.';
      empty.appendChild(icon);
      empty.appendChild(text);
      pixelContainer.appendChild(empty);
      return;
    }

    // Sort by most recent open
    pixels.sort((a, b) => {
      if (!a.lastOpen && !b.lastOpen) return 0;
      if (!a.lastOpen) return 1;
      if (!b.lastOpen) return -1;
      return new Date(b.lastOpen) - new Date(a.lastOpen);
    });

    const list = document.createElement('div');
    list.className = 'pixel-list';

    pixels.forEach(p => {
      const item = document.createElement('div');
      item.className = 'pixel-item';
      item.dataset.id = p.id;

      const opens = document.createElement('div');
      opens.className = 'pixel-opens';
      opens.textContent = p.opens;

      const info = document.createElement('div');
      info.className = 'pixel-info';

      if (p.recipient) {
        const recipDiv = document.createElement('div');
        recipDiv.className = 'pixel-recipient';
        recipDiv.textContent = p.recipient;
        info.appendChild(recipDiv);
      } else {
        const idDiv = document.createElement('div');
        idDiv.className = 'pixel-id';
        idDiv.textContent = p.id;
        info.appendChild(idDiv);
      }

      const meta = document.createElement('div');
      meta.className = 'pixel-meta';
      const metaParts = [];
      if (p.recipient) metaParts.push(p.id);
      metaParts.push(p.lastOpen ? timeAgo(p.lastOpen) : 'No opens yet');
      meta.textContent = metaParts.join(' · ');
      item.appendChild(opens);
      item.appendChild(info);

      item.addEventListener('click', () => showDetail(p.id));
      list.appendChild(item);
    });

    pixelContainer.appendChild(list);
  } catch (err) {
    pixelContainer.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    const icon = document.createElement('div');
    icon.style.fontSize = '24px';
    icon.textContent = '⚠️';
    const text = document.createElement('p');
    if (err.message === 'Authentication required') {
      text.textContent = 'Password incorrect. Please update your settings.';
    } else {
      text.textContent = `Error: ${err.message}`;
    }
    empty.appendChild(icon);
    empty.appendChild(text);
    pixelContainer.appendChild(empty);
  }
}

async function createPixel() {
  try {
    const data = await api('/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    showToast(`Tracker "${data.id}" created!`);
    loadPixels();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function deleteCurrentPixel() {
  if (!currentPixelId) return;
  if (!confirm(`Delete tracker "${currentPixelId}"? This cannot be undone.`)) return;

  try {
    await api(`/d/${currentPixelId}`, { method: 'DELETE' });
    showToast('Tracker deleted');
    showList();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function saveSettings() {
  const input = document.getElementById('server-input').value.trim().replace(/\/$/, '');
  const passwordInput = document.getElementById('password-input').value.trim();
  const errorEl = document.getElementById('setup-error');

  if (!input) {
    errorEl.textContent = 'Please enter a URL';
    errorEl.style.display = 'block';
    errorEl.style.color = '#ef4444';
    return;
  }

  // Test connection
  errorEl.textContent = 'Connecting...';
  errorEl.style.display = 'block';
  errorEl.style.color = '#888';

  try {
    const headers = {};
    if (passwordInput) {
      headers['Authorization'] = 'Basic ' + btoa(':' + passwordInput);
    }
    const res = await fetch(`${input}/list`, { headers });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    await res.json();
  } catch (err) {
    errorEl.textContent = `Can't connect: ${err.message}`;
    errorEl.style.color = '#ef4444';
    return;
  }

  serverUrl = input;
  dashboardPassword = passwordInput;
  authFailed = false;
  await chrome.storage.sync.set({ serverUrl: input, dashboardPassword: passwordInput, authFailed: false });
  
  // Clear temp storage after successful save
  await chrome.storage.local.remove(['tempServerUrl', 'tempPassword']);
  
  errorEl.style.display = 'none';
  showToast('Connected!');

  setupView.style.display = 'none';
  listView.style.display = 'block';
  loadPixels();
}

// --- Utilities ---
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2000);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  });
}

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function truncate(str, len) {
  if (!str) return '?';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function renderEventList(container, events, isFiltered) {
  if (events.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:#444;font-size:12px;';
    empty.textContent = isFiltered ? 'No filtered events' : 'No opens yet';
    container.appendChild(empty);
    return;
  }
  events.forEach(e => {
    const item = document.createElement('div');
    item.className = 'event-item';

    const timeDiv = document.createElement('div');
    timeDiv.className = 'event-time';
    timeDiv.textContent = timeAgo(e.time);

    if (isFiltered) {
      const label = document.createElement('span');
      const reason = e.reason === 'self_view' || e.reason === 'sender_ip'
        ? 'Self-open' : 'Bot / Proxy';
      label.style.cssText = reason === 'Self-open'
        ? 'color:#fb923c;font-size:10px;margin-left:6px;'
        : 'color:#ef4444;font-size:10px;margin-left:6px;';
      label.textContent = reason;
      timeDiv.appendChild(label);
    }

    const detailDiv = document.createElement('div');
    detailDiv.className = 'event-detail';
    detailDiv.textContent = `${e.country || '?'} · ${e.ip || '?'} · ${truncate(e.userAgent || '', 50)}`;

    item.appendChild(timeDiv);
    item.appendChild(detailDiv);
    container.appendChild(item);
  });
}
