// Shared HTTP helpers for the serverless functions: CORS, client IP, body
// reading, and small response utilities. No secrets live here.

/**
 * Apply permissive-but-scoped CORS headers.
 *  - Browser-extension origins (chrome-extension://, moz-extension://) are always
 *    reflected, so the published extension works with no configuration.
 *  - Any origin listed in ALLOWED_ORIGINS (comma-separated) is also reflected.
 *  - Set ALLOWED_ORIGINS="*" to allow everything (useful for local testing).
 */
export function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const allowList = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let allow = '';
  if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
    allow = origin;
  } else if (allowList.includes(origin)) {
    allow = origin;
  } else if (allowList.includes('*')) {
    allow = '*';
  }

  if (allow) {
    res.setHeader('Access-Control-Allow-Origin', allow);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/** Best-effort client IP for rate limiting (trusts Vercel's x-forwarded-for). */
export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * Read the JSON body. Vercel's Node runtime already parses application/json into
 * req.body; fall back to parsing a raw string if it didn't.
 * @returns {object} parsed body, or {} on anything unparseable
 */
export function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b.trim()) {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return {};
}
