export const PIXEL = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg=='
), c => c.charCodeAt(0));

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const BOT_PATTERNS = [
  /GoogleImageProxy/i,
  /Google-SMTP-STS/i,
  /Yahoo! Slurp/i,
  /Outlook-iOS/i,
  /Microsoft Outlook/i,
  /ms-office/i,
  /BCLinked/i,
  /Safelinks/i,
  /YahooMailProxy/i,
  /Thunderbird/i,
];

// Google Image Proxy IP ranges (66.249.x.x used by Gmail proxy)
export const PROXY_IP_PREFIXES = ['66.249.'];

export const DEDUP_WINDOW_MS = 5000;

export const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%236366f1'/><path d='M20 35c0-3 2-5 5-5h50c3 0 5 2 5 5v30c0 3-2 5-5 5H25c-3 0-5-2-5-5V35z' fill='none' stroke='white' stroke-width='5'/><path d='M22 33l28 22 28-22' fill='none' stroke='white' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/><circle cx='75' cy='28' r='12' fill='%2334d399'/><text x='75' y='33' text-anchor='middle' fill='white' font-size='16' font-weight='bold'>1</text></svg>";

export const LOGO_SVG = '<svg width="22" height="22" viewBox="0 0 100 100" style="flex-shrink:0"><rect width="100" height="100" rx="20" fill="#6366f1"/><path d="M20 35c0-3 2-5 5-5h50c3 0 5 2 5 5v30c0 3-2 5-5 5H25c-3 0-5-2-5-5V35z" fill="none" stroke="white" stroke-width="5"/><path d="M22 33l28 22 28-22" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="75" cy="28" r="12" fill="#34d399"/></svg>';

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export function isBot(userAgent, ip) {
  if (userAgent && BOT_PATTERNS.some(pattern => pattern.test(userAgent))) return true;
  if (ip && PROXY_IP_PREFIXES.some(prefix => ip.startsWith(prefix))) return true;
  return false;
}

// Length is not hidden, only the contents. Good enough for a shared password
// over the public internet, where network jitter dwarfs the comparison itself.
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkAuth(request, env) {
  // Fail closed. An unset password used to open every route to the internet,
  // exposing recipients, subjects and opener IPs to anyone who found the URL.
  if (!env.DASHBOARD_PASSWORD) return false;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;

  let decoded;
  try {
    decoded = atob(authHeader.slice(6));
  } catch {
    return false; // malformed base64 is a failed login, not a 500
  }

  // Only the first colon separates user from password; splitting on every colon
  // truncated any password that contained one, locking the owner out for good.
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;

  return constantTimeEqual(decoded.slice(sep + 1), env.DASHBOARD_PASSWORD);
}

export function requireAuth(env, extraHeaders = {}) {
  if (!env.DASHBOARD_PASSWORD) {
    return new Response(
      'Mail Tracker is not configured.\n\n' +
      'DASHBOARD_PASSWORD is unset, so every route is refused rather than left open.\n' +
      'Set it with:  npx wrangler secret put DASHBOARD_PASSWORD\n',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders } },
    );
  }
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Mail Tracker"', ...extraHeaders },
  });
}

export function servePixel() {
  return new Response(PIXEL, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    },
  });
}

// JSON.stringify leaves "<" untouched, so a value containing "</script>" would
// close an inline <script> early and run as markup. Anything interpolated into a
// <script> block must go through this instead.
const SCRIPT_UNSAFE = /[<\u2028\u2029]/g;
const SCRIPT_ESCAPES = { '<': '\\u003c', '\u2028': '\\u2028', '\u2029': '\\u2029' };

export function jsonForScript(value) {
  return JSON.stringify(value).replace(SCRIPT_UNSAFE, c => SCRIPT_ESCAPES[c]);
}

// Nonce-based CSP: the dashboard and detail pages carry one inline <script> each.
// Inline style="" attributes are used throughout the markup, so style-src stays
// 'unsafe-inline' — a nonce there would silently break the layout.
function csp(nonce) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function html(content, nonce) {
  return new Response(content, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp(nonce),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
