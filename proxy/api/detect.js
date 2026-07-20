// POST /api/detect  { text } -> { score, signals } | { unavailable, reason }
// Stage-2 AI-generation detection. CORS-scoped, per-IP rate limited, and cached
// by content hash so identical post text is only scored once.
import { applyCors, clientIp, readBody } from '../lib/http.js';
import { sha256 } from '../lib/hash.js';
import { cacheGet, cacheSet, rateLimit } from '../lib/store.js';
import { runDetect } from '../lib/detect.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  const limit = Number(process.env.RATE_LIMIT_DETECT || 60);
  const rl = await rateLimit(`rl:detect:${clientIp(req)}`, limit, 60);
  res.setHeader('X-RateLimit-Limit', String(rl.limit));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.ok) return res.status(429).json({ error: 'rate-limited' });

  const body = readBody(req);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'missing-text' });
  if (text.length > 8000) return res.status(413).json({ error: 'text-too-long' });

  const cacheKey = `det:${await sha256(text)}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached);
  }

  const result = await runDetect(text);
  if (!result) return res.status(200).json({ unavailable: true, reason: 'no-provider' });

  await cacheSet(cacheKey, result, Number(process.env.CACHE_TTL_DETECT || 86400));
  res.setHeader('X-Cache', 'MISS');
  return res.status(200).json(result);
}
