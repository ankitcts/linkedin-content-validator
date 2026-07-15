// Stage-3: credibility / claim analysis (distinct from AI-generation detection).
//
// Pipeline: gather free web evidence (search.js) -> ask an LLM (llm.js) to assess
// the post's factual claims against that evidence -> parse a structured result.
// This is ASSISTIVE — a credibility signal with flagged claims, never a hard
// "fake" verdict. Degrades gracefully (returns { unavailable, reason }) when no
// LLM token is set or a call fails.
import { LLM_PROVIDER } from './llm.js';
import { searchEvidence } from './search.js';

export const VERDICTS = ['authentic', 'mixed', 'dicey'];
export const CLAIM_STATUSES = ['supported', 'unverified', 'disputed'];

/** Build the chat messages for the credibility analysis. */
export function buildMessages(text, evidence) {
  const refs =
    Array.isArray(evidence) && evidence.length
      ? evidence.map((e, i) => `[${i + 1}] ${e.title}: ${e.snippet}`).join('\n')
      : '(no reference snippets found)';
  const system =
    'You are a careful, neutral media-literacy assistant. You assess the CREDIBILITY of a ' +
    'social-media post — you never assume it is false. Identify the concrete factual claims and, ' +
    'using the reference snippets when relevant, mark each as supported, unverified, or disputed. ' +
    'Flag sensationalism or manipulation. Be conservative: if you cannot verify a claim, use ' +
    '"unverified", not "disputed". Respond with ONLY minified JSON of this exact shape and nothing ' +
    'else: {"verdict":"authentic|mixed|dicey","confidence":0-100,' +
    '"claims":[{"claim":"...","status":"supported|unverified|disputed","note":"..."}],"summary":"..."}';
  const user = `POST:\n"""${text}"""\n\nREFERENCE SNIPPETS:\n${refs}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Extract and validate the JSON credibility object from an LLM text response,
 * tolerating code fences / surrounding prose.
 * @returns {{ verdict: string, confidence: number, claims: Array, summary: string } | null}
 */
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

async function readLlmKey() {
  const key = LLM_PROVIDER.apiKeyStorageKey;
  if (!key) return '';
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return typeof value === 'string' ? value.trim() : '';
}

async function readLlmModel() {
  const key = LLM_PROVIDER.modelStorageKey;
  if (!key) return LLM_PROVIDER.defaultModel;
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return typeof value === 'string' && value.trim() ? value.trim() : LLM_PROVIDER.defaultModel;
}

/**
 * Run the credibility pipeline for a post.
 * @param {string} text
 * @returns {Promise<object>} { verdict, confidence, claims, summary, evidence } or { unavailable, reason }
 */
export async function analyzeCredibility(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { unavailable: true, reason: 'empty' };
  }
  const apiKey = await readLlmKey();
  if (!apiKey) return { unavailable: true, reason: 'no-token' };

  const evidence = await searchEvidence(text);
  const messages = buildMessages(text, evidence);
  const model = await readLlmModel();

  try {
    const { url, options } = LLM_PROVIDER.buildRequest(messages, apiKey, model);
    const res = await fetch(url, options);
    if (!res.ok) return { unavailable: true, reason: `http-${res.status}` };
    const raw = await res.json();
    const parsed = parseCredibility(LLM_PROVIDER.parseContent(raw));
    if (!parsed) return { unavailable: true, reason: 'parse' };
    return { ...parsed, evidence };
  } catch {
    return { unavailable: true, reason: 'network' };
  }
}
