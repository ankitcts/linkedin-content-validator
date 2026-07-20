// POST /api/credibility  { text }
//   -> { verdict, confidence, claims, summary, evidence } | { unavailable, reason }
// Stage-3 on-demand credibility / claim analysis (Gemini Flash + Google Search).
// Lower rate limit and shorter cache TTL than /detect since it's costlier.
import { applyCors, clientIp, readBody } from '../lib/http.js';
import { sha256 } from '../lib/hash.js';
import { cacheGet, cacheSet, rateLimit } from '../lib/store.js';
import { runCredibility } from '../lib/credibility.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  const limit = Number(process.env.RATE_LIMIT_CREDIBILITY || 15);
  const rl = await rateLimit(`rl:cred:${clientIp(req)}`, limit, 60);
  res.setHeader('X-RateLimit-Limit', String(rl.limit));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.ok) return res.status(429).json({ error: 'rate-limited' });

  const body = readBody(req);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'missing-text' });
  if (text.length > 8000) return res.status(413).json({ error: 'text-too-long' });

  const cacheKey = `cred:${await sha256(text)}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached);
  }

  const result = await runCredibility(text);
  // Only cache genuine results (never cache a transient "unavailable").
  if (!result.unavailable) {
    await cacheSet(cacheKey, result, Number(process.env.CACHE_TTL_CREDIBILITY || 21600));
    res.setHeader('X-Cache', 'MISS');
  }
  return res.status(200).json(result);
}
