// GET /api/health -> liveness + which providers are configured (no secrets).
// Useful to confirm a deployment has the env vars it needs before wiring the
// extension to it.
import { applyCors } from '../lib/http.js';

export default function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  return res.status(200).json({
    ok: true,
    service: 'authenticity-notes-proxy',
    providers: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      huggingface: Boolean(process.env.HF_TOKEN),
      pangram: Boolean(process.env.PANGRAM_API_KEY),
    },
    cache:
      (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
      (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
        ? 'upstash'
        : 'in-memory',
  });
}
