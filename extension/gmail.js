// Gmail content script — auto-injects tracking pixel on Send
// Strategy: Only inject pixels when Send button is clicked

(function () {
  const LOG = '[MailTracker]';
  let serverUrl = '';
  let dashboardPassword = '';
  let trackingEnabled = true;

  // Add CSS for read indicators
  const style = document.createElement('style');
  style.textContent = `
    .mail-tracker-status {
      display: inline-block;
      margin-left: 4px;
      font-size: 11px;
      font-weight: bold;
      cursor: help;
      opacity: 0.8;
      transition: opacity 0.2s;
    }
    .mail-tracker-status:hover {
      opacity: 1;
    }
  `;
  document.head.appendChild(style);

  // Cache for tracking data to avoid excessive API calls
  let trackingDataCache = null;
  let lastCacheUpdate = 0;
  const CACHE_DURATION = 5000; // 5 second cache
  let currentView = '';

  // Get tracking data with caching
  async function getTrackingData() {
    const now = Date.now();
    
    console.log(LOG, 'getTrackingData called - cache age:', now - lastCacheUpdate, 'ms');
    
    // Return cached data if still valid
    if (trackingDataCache && (now - lastCacheUpdate) < CACHE_DURATION) {
      console.log(LOG, 'Using cached data, no API call');
      return trackingDataCache;
    }
    
    console.log(LOG, 'Cache expired or empty, making API call...');
    
    try {
      const headers = {};
      if (dashboardPassword) {
        headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
      }
      
      console.log(LOG, 'Making /list API call');
      const res = await fetch(`${serverUrl}/list`, { headers, signal: AbortSignal.timeout(NEW_PIXEL_TIMEOUT_MS) });
      if (res.ok) {
        trackingDataCache = await res.json();
        lastCacheUpdate = now;
        console.log(LOG, 'API call successful, cached', trackingDataCache.length, 'trackers');
        return trackingDataCache;
      } else {
        console.warn(LOG, 'Failed to fetch tracking data:', res.status);
        return [];
      }
    } catch (e) {
      console.warn(LOG, 'Error fetching tracking data:', e);
      return [];
    }
  }

  // Load settings
  chrome.storage.sync.get(['serverUrl', 'autoTrack', 'dashboardPassword'], (result) => {
    serverUrl = result.serverUrl || '';
    dashboardPassword = result.dashboardPassword || '';
    trackingEnabled = result.autoTrack !== false;
    console.log(LOG, 'Loaded settings:', { serverUrl: serverUrl ? 'set' : 'empty', trackingEnabled });
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.serverUrl) serverUrl = changes.serverUrl.newValue || '';
    if (changes.dashboardPassword) dashboardPassword = changes.dashboardPassword.newValue || '';
    if (changes.autoTrack) trackingEnabled = changes.autoTrack.newValue !== false;
  });

  // Extract email addresses from a compose form
  function getRecipients(composeForm) {
    const recipients = new Set();

    // Method 1: span[email] inside recipient rows (most reliable in current Gmail)
    composeForm.querySelectorAll('span[email]').forEach(el => {
      const email = el.getAttribute('email');
      if (email && email.includes('@')) recipients.add(email.toLowerCase());
    });

    // Method 2: data-hovercard-id on recipient chips
    composeForm.querySelectorAll('[data-hovercard-id]').forEach(el => {
      const email = el.getAttribute('data-hovercard-id');
      if (email && email.includes('@')) recipients.add(email.toLowerCase());
    });

    // Method 3: [email] attribute
    composeForm.querySelectorAll('[email]').forEach(el => {
      const email = el.getAttribute('email');
      if (email && email.includes('@')) recipients.add(email.toLowerCase());
    });

    return Array.from(recipients);
  }

  // Extract email subject and body preview
  function getEmailContent(composeForm) {
    // Try multiple selectors for subject
    const subjectEl = composeForm.querySelector('input[name="subjectbox"]') ||
                     composeForm.querySelector('input[aria-label*="Subject"]') ||
                     composeForm.querySelector('input[placeholder*="Subject"]') ||
                     composeForm.querySelector('[data-tooltip*="Subject"] input');
    
    const subject = subjectEl?.value || '';
    
    // Try multiple selectors for body
    const bodyEl = composeForm.querySelector('[contenteditable="true"][aria-label*="Message"]') ||
                   composeForm.querySelector('[contenteditable="true"][role="textbox"]') ||
                   composeForm.querySelector('.Am.Al.editable') ||
                   composeForm.querySelector('[contenteditable="true"]');
    
    let bodyPreview = '';
    if (bodyEl) {
      const text = bodyEl.innerText || bodyEl.textContent || '';
      // Get first 2 lines, max 200 chars
      const lines = text.split('\n').filter(line => line.trim());
      bodyPreview = lines.slice(0, 2).join(' ').substring(0, 200);
    }
    
    console.log(LOG, 'Extracted content:', { subject, bodyPreview: bodyPreview.substring(0, 50) + '...' });
    return { subject: subject.trim(), bodyPreview: bodyPreview.trim() };
  }

  // Find compose form containing a body element
  function findComposeForm(bodyEl) {
    return bodyEl.closest('[role="dialog"]') || bodyEl.closest('.nH') || bodyEl.closest('form');
  }

  // Find all compose body elements
  function findComposeBodies() {
    return Array.from(document.querySelectorAll('div[contenteditable="true"]'))
      .filter(el => el.closest('[role="dialog"]') || el.closest('.nH'));
  }

  // Check which recipients don't have tracking pixels yet
  function getUntrackedRecipients(bodyEl, recipients) {
    const existing = Array.from(bodyEl.querySelectorAll('img[data-mail-tracker-to]'))
      .map(img => img.getAttribute('data-mail-tracker-to'));
    return recipients.filter(email => !existing.includes(email));
  }

  // A hung worker used to swallow the click outright: Send was cancelled and the
  // replacement click only fired once the fetch settled, which never happened.
  const NEW_PIXEL_TIMEOUT_MS = 3000;

  // Inject tracking pixel into a compose body for given recipients
  async function injectTracker(bodyEl, recipients) {
    if (!serverUrl || recipients.length === 0) return;

    const form = findComposeForm(bodyEl);
    const emailContent = getEmailContent(form);
    const contentArea = bodyEl.querySelector('[contenteditable="true"]')
      || bodyEl.querySelector('.Am.Al.editable')
      || bodyEl;

    const headers = { 'Content-Type': 'application/json' };
    if (dashboardPassword) headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);

    // In parallel, so one slow recipient does not add its timeout to the rest.
    const created = await Promise.all(recipients.map(async (recipient) => {
      const messageId = Date.now() + '-' + Math.random().toString(36).slice(2, 11);
      try {
        const res = await fetch(`${serverUrl}/new`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            to: recipient,
            subject: emailContent.subject,
            bodyPreview: emailContent.bodyPreview,
            messageId,
          }),
          signal: AbortSignal.timeout(NEW_PIXEL_TIMEOUT_MS),
        });
        if (!res.ok) {
          console.warn(LOG, 'Failed to create tracker for', recipient, '- status:', res.status);
          return null;
        }
        return { data: await res.json(), recipient, messageId };
      } catch (e) {
        console.warn(LOG, 'Error creating tracker for', recipient, e.message);
        return null;
      }
    }));

    for (const { data, recipient, messageId } of created.filter(Boolean)) {
      const img = document.createElement('img');
      img.src = data.pixel;
      img.width = 1;
      img.height = 1;
      img.style.cssText = 'display:none!important;width:1px!important;height:1px!important;opacity:0!important;position:absolute!important;';
      img.setAttribute('data-mail-tracker', data.id);
      img.setAttribute('data-mail-tracker-to', recipient);
      img.setAttribute('data-message-id', messageId);
      contentArea.appendChild(img);
      console.log(LOG, 'Injected tracker for', recipient, '- id:', data.id);
    }
  }

  // Extract unique identifiers from Gmail thread
  function getEmailIdentifiers(row) {
    // Try to get Gmail's thread ID or message ID
    const threadId = row.querySelector('[data-thread-id]')?.getAttribute('data-thread-id') ||
                    row.querySelector('[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id');
    
    // Get subject from the email row
    const subjectEl = row.querySelector('.bog span') || row.querySelector('.y6 span');
    const subject = subjectEl?.textContent?.trim() || '';
    
    // Get timestamp
    const timeEl = row.querySelector('[title*="2026"]') || row.querySelector('span[title]');
    const timestamp = timeEl?.getAttribute('title') || '';
    
    return { threadId, subject, timestamp };
  }

  // Find best matching tracker for an email
  function findMatchingTracker(trackers, email, identifiers) {
    // First try exact subject + recipient match
    let matches = trackers.filter(t => 
      t.recipient === email && 
      t.subject && 
      identifiers.subject.includes(t.subject)
    );
    
    if (matches.length === 1) return matches[0];
    
    // If multiple matches, try to find most recent
    if (matches.length > 1) {
      return matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    }
    
    // Fallback to any tracker for this recipient (most recent)
    matches = trackers.filter(t => t.recipient === email);
    if (matches.length > 0) {
      return matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    }
    
    return null;
  }
  function addReadIndicators(composeForm) {
    console.log(LOG, 'Adding read indicators...');
    
    // Find all recipient chips in the compose form
    const recipientChips = composeForm.querySelectorAll('span[email], [data-hovercard-id]');
    console.log(LOG, 'Found recipient chips:', recipientChips.length);
    
    recipientChips.forEach(async (chip) => {
      const email = chip.getAttribute('email') || chip.getAttribute('data-hovercard-id');
      if (!email || chip.querySelector('.mail-tracker-status')) return;
      
      console.log(LOG, 'Adding indicator for:', email);
      
      // Create status indicator
      const statusEl = document.createElement('span');
      statusEl.className = 'mail-tracker-status';
      statusEl.style.cssText = 'margin-left: 6px; font-size: 12px; color: #5f6368; cursor: help; font-weight: bold;';
      statusEl.textContent = '✓'; // Single tick for sent
      statusEl.title = 'Sent but not opened yet';
      
      // Insert after the chip
      chip.parentNode.insertBefore(statusEl, chip.nextSibling);
      console.log(LOG, 'Indicator added for:', email);
      
      // Update status with cached data
      const trackers = await getTrackingData();
      const tracker = trackers.find(t => t.recipient === email);
      
      if (tracker && tracker.opens > 0) {
        statusEl.textContent = '✓✓'; // Double tick for read
        statusEl.style.color = '#1a73e8'; // Blue for read
        
        const lastOpen = tracker.lastOpen ? new Date(tracker.lastOpen).toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          month: 'short',
          day: 'numeric'
        }) : 'never';
        
        statusEl.title = `Opened ${tracker.opens} time${tracker.opens > 1 ? 's' : ''}\nLast opened: ${lastOpen}`;
      }
    });
  }

  // Process a compose window — inject pixels for untracked recipients
  async function processCompose(bodyEl) {
    const form = findComposeForm(bodyEl);
    if (!form) {
      console.log(LOG, 'Could not find compose form for body element');
      return;
    }

    const recipients = getRecipients(form);
    if (recipients.length === 0) return;

    const untracked = getUntrackedRecipients(bodyEl, recipients);
    if (untracked.length === 0) return;

    console.log(LOG, 'Found untracked recipients:', untracked);
    await injectTracker(bodyEl, untracked);
  }

  // Watch for Send button clicks — block send, inject pixels, then allow send
  let isSending = false; // Flag to prevent infinite loop
  
  function setupSendInterception() {
    document.addEventListener('click', async (e) => {
      if (!trackingEnabled || !serverUrl) return;
      if (isSending) return; // Skip if already sending

      const target = e.target.closest(
        'div[role="button"][aria-label*="Send"], ' +
        'div[role="button"][data-tooltip*="Send"]'
      );

      if (!target) return;

      console.log(LOG, 'Send button clicked - checking for untracked recipients');
      e.stopPropagation();
      e.preventDefault();
      isSending = true;

      // Whatever happens to the pixels, the mail still has to go out.
      try {
        for (const body of findComposeBodies()) await processCompose(body);
      } catch (err) {
        console.warn(LOG, 'Pixel injection failed, sending anyway:', err.message);
      }

      setTimeout(() => {
        target.click();
        setTimeout(() => { isSending = false; }, 1000);
      }, 100);
    }, true); // Use capture phase to intercept before Gmail
  }

  // Periodically update read indicators for open compose windows
  function startStatusUpdater() {
    // No periodic updates - only fetch on view changes
  }

  // Add read indicators to sent emails in inbox view
  async function addInboxReadIndicators() {
    if (!serverUrl || !dashboardPassword) return;
    
    console.log(LOG, 'addInboxReadIndicators called');
    
    // First, remove all existing indicators to prevent duplicates
    document.querySelectorAll('.mail-tracker-status').forEach(el => el.remove());
    console.log(LOG, 'Cleared existing indicators');
    
    // Fetch tracking data ONCE before processing emails
    const trackers = await getTrackingData();
    console.log(LOG, 'Got', trackers.length, 'trackers for processing');
    
    // Find sent email rows (emails with "To: " prefix)
    const sentRows = document.querySelectorAll('tr[role="row"]');
    console.log(LOG, 'Found', sentRows.length, 'email rows');
    
    sentRows.forEach((row, index) => {
      const toField = row.querySelector('.yW');
      if (!toField || !toField.textContent.startsWith('To: ')) return;
      
      const emailSpan = toField.querySelector('span[email]');
      if (!emailSpan) return; // Remove the duplicate check since we cleared all indicators above
      
      const email = emailSpan.getAttribute('email');
      console.log(LOG, 'Processing row', index, 'for email:', email);
      
      // Get email identifiers for better matching
      const identifiers = getEmailIdentifiers(row);
      console.log(LOG, 'Email identifiers:', identifiers);
      
      // Find the best matching tracker for this specific email
      const tracker = findMatchingTracker(trackers, email, identifiers);
      
      // Only add indicator if email was tracked
      if (!tracker) {
        console.log(LOG, 'Email', email, 'not tracked, skipping');
        return;
      }
      
      console.log(LOG, 'Found tracked email to:', email);
      
      // Create status indicator
      const statusEl = document.createElement('span');
      statusEl.className = 'mail-tracker-status';
      statusEl.style.cssText = 'margin-left: 6px; font-size: 11px; color: #5f6368; cursor: help; font-weight: bold;';
      
      if (tracker.opens > 0) {
        statusEl.textContent = '✓✓'; // Double tick for read
        statusEl.style.color = '#1a73e8'; // Blue for read
        
        const lastOpen = tracker.lastOpen ? new Date(tracker.lastOpen).toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          month: 'short',
          day: 'numeric'
        }) : 'never';
        
        statusEl.title = `Opened ${tracker.opens} time${tracker.opens > 1 ? 's' : ''}\nLast opened: ${lastOpen}`;
      } else {
        statusEl.textContent = '✓'; // Single tick for sent
        statusEl.title = 'Sent but not opened yet';
      }
      
      // Insert after email span
      emailSpan.parentNode.insertBefore(statusEl, emailSpan.nextSibling);
      console.log(LOG, 'Added indicator for tracked email:', email);
    });
  }

  // ---- Self-view detection ----
  // When the sender opens a thread containing tracked pixels, notify the worker
  // so it can filter out the self-open (Gmail proxy fires /t/:id around the same time)

  const SELF_VIEW_DELAY_MS = 1000;


  function isThreadView() {
    // Gmail thread URLs look like #inbox/FMfcg... or #sent/FMfcg... or #label/FMfcg...
    const hash = location.hash;
    // Thread views have a second path segment (the thread ID)
    const parts = hash.replace('#', '').split('/');
    return parts.length >= 2 && parts[1].length > 5;
  }

  // Find tracker pixel IDs directly from <img> tags in the thread DOM
  // Gmail proxies images like: https://ci3.googleusercontent.com/meips/...#https://mail-tracker.xxx.workers.dev/t/8bdcb976
  // The actual pixel URL is after the # fragment
  function findPixelIdsInThread() {
    const ids = new Set();
    if (!serverUrl) return [];

    // Extract the host from our server URL to avoid matching other sites' /t/ paths
    const serverHost = new URL(serverUrl).host;

    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.getAttribute('src') || '';
      // Only match if src contains our server host
      if (!src.includes(serverHost)) return;
      // 8 chars covers trackers created before IDs were widened to 16.
      const match = src.match(/\/t\/([a-f0-9]{8,32})\b/);
      if (match) ids.add(match[1]);
    });

    // Also check data attributes set during injection (before Gmail proxied them)
    document.querySelectorAll('img[data-mail-tracker]').forEach(img => {
      ids.add(img.getAttribute('data-mail-tracker'));
    });

    return Array.from(ids);
  }

  async function notifySelfView(ids) {
    if (!serverUrl || ids.length === 0) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (dashboardPassword) {
        headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
      }
      console.log(LOG, `[self-view] POST /self — ids:`, ids);
      const res = await fetch(`${serverUrl}/self`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        const data = await res.json();
        console.log(LOG, '[self-view] response:', JSON.stringify(data));
      } else {
        console.warn(LOG, `[self-view] server returned ${res.status}`);
      }
    } catch (e) {
      console.warn(LOG, `[self-view] error:`, e.message);
    }
  }

  let selfViewTimer = null;

  async function checkSelfView() {
    if (!serverUrl || !isThreadView()) return;

    const ids = findPixelIdsInThread();
    console.log(LOG, `[self-view] found ${ids.length} pixel(s) in thread:`, ids);

    if (ids.length === 0) return;

    // Cancel any existing pending call
    if (selfViewTimer) {
      clearTimeout(selfViewTimer);
      selfViewTimer = null;
    }

    selfViewTimer = setTimeout(async () => {
      await notifySelfView(ids);
      selfViewTimer = null;
    }, SELF_VIEW_DELAY_MS);
  }

  function cancelPendingSelfViews() {
    if (selfViewTimer) {
      console.log(LOG, '[self-view] cancelling pending self-view call (user left thread)');
      clearTimeout(selfViewTimer);
      selfViewTimer = null;
    }
  }

  // Initialize tracking
  if (window.location.hostname === 'mail.google.com') {
    console.log(LOG, 'Initializing...');
    setupSendInterception();

    // Detect view changes and fetch data only when needed
    let lastUrl = location.href;

    function handleViewChange() {
      const newView = location.hash;
      console.log(LOG, 'URL changed to:', newView);

      // Only process if we're actually changing to sent folder view
      if (newView !== currentView && newView === '#sent') {
        currentView = newView;
        console.log(LOG, 'Entered sent folder, loading indicators');
        // Clear cache on view change to force fresh data
        trackingDataCache = null;
        setTimeout(() => addInboxReadIndicators(), 1000);
      } else if (newView !== currentView) {
        currentView = newView;
        console.log(LOG, 'Changed to:', currentView, '- not sent folder, skipping');
      }

      // Self-view detection: check if user opened a thread with tracked pixels
      if (isThreadView()) {
        console.log(LOG, '[self-view] thread view detected, will check for tracked pixels');
        // Small delay to let Gmail render the thread content
        setTimeout(() => checkSelfView(), 800);
      } else {
        // User left a thread view — cancel any pending self-view calls
        cancelPendingSelfViews();
      }
    }

    // Initial load
    if (location.hash === '#sent') {
      handleViewChange();
    }
    // Also check if we loaded directly into a thread
    if (isThreadView()) {
      setTimeout(() => checkSelfView(), 1500);
    }

    // Watch for URL changes with polling instead of MutationObserver
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        handleViewChange();
      }
    }, 1000);
  }

})();
