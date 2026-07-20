# Authenticity Notes — hosted backend proxy

Serverless backend (Vercel functions) so the Chrome extension works **with no
user API key**. It holds the provider keys server-side, rate-limits per IP, and
caches by content hash so identical post text is only scored once.

## Endpoints

| Method + path         | Body       | Returns |
| --------------------- | ---------- | ------- |
| `POST /api/detect`      | `{ text }` | `{ score, signals }` — Stage-2 AI-generation detection, or `{ unavailable, reason }` |
| `POST /api/credibility` | `{ text }` | `{ verdict, confidence, claims, summary, evidence }` — Stage-3 claim analysis, or `{ unavailable, reason }` |
| `GET  /api/health`      | –          | liveness + which providers are configured (no secrets) |

CORS is scoped to browser-extension origins (`chrome-extension://`,
`moz-extension://`) automatically; add web origins via `ALLOWED_ORIGINS`.

## Deploy

1. Deploy this directory to Vercel (root directory = `proxy`).
2. In **Project → Settings → Environment Variables**, add at least
   `GEMINI_API_KEY` (from Google AI Studio). See [`.env.example`](./.env.example)
   for the full list.
3. Redeploy so the new env vars take effect.
4. Confirm with `GET /api/health` — `providers.gemini` should be `true`.

The extension defaults to this backend (`DEFAULT_BACKEND_URL` in
`src/service-worker/backend.js`); users can override it in the options page.

## Providers

**Credibility** uses **Gemini 2.5 Flash** with built-in **Google Search
grounding** — one key (`GEMINI_API_KEY`) powers fact-checking against live
sources, and the grounding chunks become the card's evidence list.

**Detection** picks the first configured provider: `PANGRAM_API_KEY` →
`HF_TOKEN` → `GEMINI_API_KEY` (heuristic estimate). So the backend is functional
with only the Gemini key; add an HF token for a purpose-built open detector, or
Pangram for best accuracy.

### AI-detection alternatives to Pangram

All are drop-in REST APIs — add a branch in `lib/detect.js` and its key:

| Provider          | Notes |
| ----------------- | ----- |
| **Hugging Face** (built in) | Free open RoBERTa/DeBERTa detector; imperfect on short marketing copy, but no per-call cost. |
| **GPTZero**       | Highest-accuracy commercial API; sentence-level scores; ~$179/mo dev tier. |
| **Originality.ai**| Content-team focused; AI + plagiarism; ~$12.95/mo entry, metered API. |
| **Sapling**       | Sentence-level + overall score; generous free tier; Pro ~$25/mo. |
| **Winston AI**    | Developer-friendly API + dashboard, credit-based. |
| **Copyleaks**     | AI detection + plagiarism; SDKs; enterprise-oriented. |
| **Self-hosted**   | Run a RoBERTa/DeBERTa detector on Workers AI / a GPU box — no per-call cost, full control, you own accuracy + upkeep. |

## Cache + rate limiting

Backed by **Upstash Redis** (or Vercel KV) when `KV_REST_API_URL` /
`KV_REST_API_TOKEN` are set — shared across instances. Without them it falls back
to a per-instance in-memory store (correct, but resets on cold starts). Set the
KV vars for production.
