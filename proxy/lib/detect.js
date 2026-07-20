// AI-text detection for /api/detect. Returns the extension's { score, signals }
// shape (score = 0-100 AI-likelihood) or null when no provider is configured
// (the extension then keeps its local Stage-1 heuristic).
//
// Provider chain, best available first — each is enabled purely by whether its
// env key is set, so the operator picks the tier by which secret they add:
//   1. Pangram          (PANGRAM_API_KEY)  — strongest, paid; see alternatives below
//   2. Hugging Face      (HF_TOKEN)         — free open RoBERTa detector
//   3. Gemini heuristic  (GEMINI_API_KEY)   — LLM estimate; works with just the Gemini key
//
// Detection alternatives to Pangram (all REST APIs, swap in via a new branch):
//   GPTZero, Originality.ai, Sapling, Winston AI, Copyleaks — or self-host a
//   RoBERTa/DeBERTa detector. See proxy/README.md for the trade-offs.
import { callGemini } from './gemini.js';

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// --- Hugging Face open detector --------------------------------------------
async function hfDetect(text) {
  const token = process.env.HF_TOKEN || '';
  if (!token) return null;
  const model = process.env.HF_DETECT_MODEL || 'fakespot-ai/roberta-base-ai-text-detection-v1';
  let res;
  try {
    res = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ inputs: text.slice(0, 4000), options: { wait_for_model: true } }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let raw;
  try {
    raw = await res.json();
  } catch {
    return null;
  }
  const rows = Array.isArray(raw) ? (Array.isArray(raw[0]) ? raw[0] : raw) : [];
  const scores = rows
    .filter((r) => r && typeof r.label === 'string' && Number.isFinite(Number(r.score)))
    .map((r) => ({ label: r.label, score: Number(r.score) }));
  if (!scores.length) return null;

  const aiRe = /chatgpt|\bai\b|fake|machine|generated|gpt|label[_-]?1/i;
  const humanRe = /human|real|label[_-]?0/i;
  const ai = scores.find((s) => aiRe.test(s.label));
  const human = scores.find((s) => humanRe.test(s.label));
  let aiProb;
  if (ai) aiProb = ai.score;
  else if (human) aiProb = 1 - human.score;
  else aiProb = scores.length > 1 ? scores[1].score : scores[0].score;

  const score = clampScore(aiProb * 100);
  return {
    score,
    signals: [
      { label: 'AI-detection model', detail: `Hugging Face detector: ${score}% AI-likelihood.` },
    ],
  };
}

// --- Pangram (paid) ---------------------------------------------------------
async function pangramDetect(text) {
  const key = process.env.PANGRAM_API_KEY || '';
  if (!key) return null;
  const endpoint = process.env.PANGRAM_ENDPOINT || 'https://text.api.pangram.com/v1/predict';
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ text: text.slice(0, 6000) }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const score = clampScore(Number(data.ai_likelihood) * 100);
  const signals = [];
  if (data.predicted_class) {
    signals.push({
      label: 'Model verdict',
      detail: `Pangram classified this text as "${data.predicted_class}".`,
    });
  }
  const fraction = Number(data.fraction_ai_content);
  if (Number.isFinite(fraction)) {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    signals.push({
      label: 'AI content fraction',
      detail: `${pct}% of the text was flagged as AI-generated.`,
    });
  }
  return { score, signals };
}

// --- Gemini heuristic estimate ---------------------------------------------
// Not a purpose-built detector, but lets the hosted backend produce a signal
// with only the Gemini key set. Clearly labelled as a heuristic estimate.
async function geminiDetect(text) {
  const system =
    'You are an AI-generated-text detector for short social-media (LinkedIn) posts. ' +
    'Weigh generic corporate phrasing, uniform sentence rhythm, "it\'s not X, it\'s Y" ' +
    'constructions, rule-of-three lists, and engagement-bait against specific, ' +
    'idiosyncratic, first-hand detail. Respond with ONLY minified JSON of this exact ' +
    'shape: {"ai_likelihood":0-100,"reason":"one short sentence"}';
  const { text: out, error } = await callGemini({ system, user: text.slice(0, 4000) });
  if (error || !out) return null;

  let obj;
  try {
    const start = out.indexOf('{');
    const end = out.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    obj = JSON.parse(out.slice(start, end + 1));
  } catch {
    return null;
  }
  const score = clampScore(obj.ai_likelihood);
  const reason = typeof obj.reason === 'string' ? obj.reason : '';
  return {
    score,
    signals: [
      {
        label: 'AI-detection (Gemini estimate)',
        detail: reason
          ? `${score}% AI-likelihood — ${reason}`
          : `${score}% AI-likelihood (heuristic).`,
      },
    ],
  };
}

/**
 * Run the first configured detection provider. Returns { score, signals } or
 * null if none is available.
 */
export async function runDetect(text) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  if (process.env.PANGRAM_API_KEY) {
    const r = await pangramDetect(clean);
    if (r) return r;
  }
  if (process.env.HF_TOKEN) {
    const r = await hfDetect(clean);
    if (r) return r;
  }
  if (process.env.GEMINI_API_KEY) {
    const r = await geminiDetect(clean);
    if (r) return r;
  }
  return null;
}
