// Credibility / claim analysis for /api/credibility. Uses Gemini 2.5 Flash with
// Google Search grounding to assess a post's factual claims against live sources.
// Returns the extension's Stage-3 shape:
//   { verdict, confidence, claims:[{claim,status,note}], summary, evidence:[...] }
// or { unavailable, reason } on any failure (the extension degrades gracefully).
import { callGemini, groundingEvidence } from './gemini.js';

export const VERDICTS = ['authentic', 'mixed', 'dicey'];
export const CLAIM_STATUSES = ['supported', 'unverified', 'disputed'];

const SYSTEM =
  'You are a careful, neutral media-literacy assistant. You assess the CREDIBILITY of a ' +
  'social-media post — you never assume it is false. Use Google Search to check the concrete ' +
  'factual claims. Mark each claim as supported, unverified, or disputed. Flag sensationalism ' +
  'or manipulation. Be conservative: if you cannot verify a claim, use "unverified", not ' +
  '"disputed". Respond with ONLY minified JSON of this exact shape and nothing else: ' +
  '{"verdict":"authentic|mixed|dicey","confidence":0-100,' +
  '"claims":[{"claim":"...","status":"supported|unverified|disputed","note":"..."}],"summary":"..."}';

/** Parse + validate the model's JSON, tolerating code fences / stray prose. */
export function parseCredibility(content) {
  if (typeof content !== 'string' || !content.trim()) return null;
  let s = content.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  let obj;
  try {
    obj = JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;

  const verdict = VERDICTS.includes(obj.verdict) ? obj.verdict : 'mixed';
  const confidence = Math.max(0, Math.min(100, Math.round(Number(obj.confidence) || 0)));
  const claims = Array.isArray(obj.claims)
    ? obj.claims
        .filter((c) => c && typeof c.claim === 'string')
        .slice(0, 8)
        .map((c) => ({
          claim: String(c.claim),
          status: CLAIM_STATUSES.includes(c.status) ? c.status : 'unverified',
          note: typeof c.note === 'string' ? c.note : '',
        }))
    : [];
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  return { verdict, confidence, claims, summary };
}

/**
 * Run the credibility pipeline for a post.
 * @param {string} text
 * @returns {Promise<object>} parsed result + evidence, or { unavailable, reason }
 */
export async function runCredibility(text) {
  const clean = String(text || '').trim();
  if (!clean) return { unavailable: true, reason: 'empty' };
  if (!process.env.GEMINI_API_KEY) return { unavailable: true, reason: 'no-key' };

  const user = `POST:\n"""${clean.slice(0, 6000)}"""`;
  const {
    text: out,
    grounding,
    error,
  } = await callGemini({ system: SYSTEM, user, useSearch: true });
  if (error) return { unavailable: true, reason: error };

  const parsed = parseCredibility(out);
  if (!parsed) return { unavailable: true, reason: 'parse' };

  return { ...parsed, evidence: groundingEvidence(grounding) };
}
