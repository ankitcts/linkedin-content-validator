// Content-hash cache + per-IP rate limiter.
//
// Backing store: Upstash Redis (REST) when KV_REST_API_URL/TOKEN (or the
// UPSTASH_REDIS_REST_* aliases) are configured — recommended for production so
// the cache and rate-limit counters are shared across serverless instances.
// Otherwise it falls back to a per-instance in-memory Map: still correct, but
// counters/cache reset on cold starts and aren't shared between instances.

const UPSTASH_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useUpstash = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

// Per-instance fallback store. value shape: { v: any, exp: epoch-ms | 0 }.
const mem = new Map();

function memGet(key) {
  const e = mem.get(key);
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) {
    mem.delete(key);
    return null;
  }
  return e.v;
}

function memSet(key, value, ttlSec) {
  mem.set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
}

async function upstash(command) {
  const path = command.map(encodeURIComponent).join('/');
  const res = await fetch(`${UPSTASH_URL}/${path}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const data = await res.json();
  return data.result;
}

/** Read a cached JSON value, or null on miss / any store error. */
export async function cacheGet(key) {
  if (useUpstash) {
    try {
      const r = await upstash(['get', key]);
      return r ? JSON.parse(r) : null;
    } catch {
      return null;
    }
  }
  return memGet(key);
}

/** Cache a JSON value with a TTL (seconds). Best-effort; never throws. */
export async function cacheSet(key, value, ttlSec) {
  if (useUpstash) {
    try {
      await upstash(['setex', key, String(ttlSec), JSON.stringify(value)]);
    } catch {
      // ignore cache write failures
    }
    return;
  }
  memSet(key, value, ttlSec);
}

/**
 * Fixed-window rate limit. Returns { ok, remaining, limit }. Fails OPEN (allows
 * the request) if the store errors, so a store outage never takes the API down.
 */
export async function rateLimit(key, limit, windowSec) {
  if (useUpstash) {
    try {
      const count = await upstash(['incr', key]);
      if (count === 1) await upstash(['expire', key, String(windowSec)]);
      return { ok: count <= limit, remaining: Math.max(0, limit - count), limit };
    } catch {
      return { ok: true, remaining: limit, limit };
    }
  }

  const now = Date.now();
  const e = mem.get(key);
  if (!e || (e.exp && e.exp < now)) {
    mem.set(key, { v: 1, exp: now + windowSec * 1000 });
    return { ok: true, remaining: limit - 1, limit };
  }
  e.v += 1;
  return { ok: e.v <= limit, remaining: Math.max(0, limit - e.v), limit };
}
