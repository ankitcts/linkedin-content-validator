// Thin client for the Google Gemini generateContent API. The API key is read
// from the GEMINI_API_KEY env var (set in the Vercel dashboard) — never shipped
// to the browser. Gemini 2.5 Flash supports built-in Google Search grounding,
// which the credibility endpoint uses to fact-check against live sources.

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/**
 * Call Gemini once.
 * @param {object} p
 * @param {string} [p.system]     system instruction
 * @param {string}  p.user        user prompt
 * @param {boolean} [p.useSearch] enable Google Search grounding
 * @returns {Promise<{ text?: string, grounding?: object|null, error?: string }>}
 */
export async function callGemini({ system, user, useSearch = false }) {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) return { error: 'no-key' };

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent` +
    `?key=${encodeURIComponent(key)}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: String(user).slice(0, 8000) }] }],
    generationConfig: { temperature: 0.2 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (useSearch) body.tools = [{ google_search: {} }];

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { error: 'network' };
  }
  if (!res.ok) return { error: `http-${res.status}` };

  let data;
  try {
    data = await res.json();
  } catch {
    return { error: 'parse' };
  }

  const cand = data && data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts
    .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  const grounding = (cand && cand.groundingMetadata) || null;
  return { text, grounding };
}

/**
 * Flatten Gemini grounding metadata into the extension's evidence shape
 * ({ title, snippet, url }), so the card can show its sources.
 */
export function groundingEvidence(grounding, limit = 4) {
  if (!grounding) return [];
  const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : [];
  const out = [];
  for (const chunk of chunks) {
    const web = chunk && chunk.web;
    if (!web || !web.uri) continue;
    out.push({
      title: typeof web.title === 'string' ? web.title : web.uri,
      snippet: '',
      url: web.uri,
    });
    if (out.length >= limit) break;
  }
  return out;
}
