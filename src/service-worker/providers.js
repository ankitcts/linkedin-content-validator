// Pluggable Stage-2 detection providers: config + request building + response
// mapping. API keys NEVER live here — they are read at call time from
// chrome.storage.local (set via the options page). See PROJECT_CONTEXT.md §4, §7.
//
// A provider is a plain object with this shape — add your own to PROVIDERS to
// plug in a different detection API; nothing else in the pipeline changes:
//
//   {
//     id: string,                       // stable identifier
//     label: string,                    // human-readable name (options page)
//     enabled: boolean,                 // false ships the extension key-free
//     apiKeyStorageKey: string,         // chrome.storage.local key for the API key
//     buildRequest(text, apiKey):       // -> { url, options } for fetch()
//       { url, options },
//     mapResponse(raw):                 // -> { score: 0-100, signals: [...] }
//       { score, signals },
//   }

// Returned when no provider is enabled/keyed, or a provider call fails, so the
// extension degrades gracefully and stays useful without a paid key. Score 50
// is the honest midpoint (maximal uncertainty); empty signals let the content
// script keep the Stage-1 card rather than assert an unevidenced verdict (§7).
export const NEUTRAL_RESULT = Object.freeze({ score: 50, signals: [] });

/** Coerce any value into an integer 0–100 score; junk becomes 0. */
function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// --- Example provider: Pangram-style text-detection API ---------------------
// Illustrative only, and disabled by default. Pangram is the strongest detector
// we surveyed (§3) but is a paid API ($0.05/1k words). The request/response
// shapes below are documented examples — verify against the live API docs and
// adjust buildRequest/mapResponse before enabling in the options page.
export const pangramProvider = {
  id: 'pangram',
  label: 'Pangram (example)',
  // Flip to true AND set a key via the options page to activate Stage-2.
  enabled: false,
  // chrome.storage.local key under which the options page stores the API key.
  // The key itself is NEVER hardcoded here (§7).
  apiKeyStorageKey: 'pangramApiKey',
  endpoint: 'https://text.api.pangram.com/v1/predict',

  /**
   * Build the fetch request for a piece of post text.
   * @param {string} text   the post body to classify
   * @param {string} apiKey read from chrome.storage.local at call time
   * @returns {{ url: string, options: RequestInit }}
   */
  buildRequest(text, apiKey) {
    return {
      url: this.endpoint,
      options: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ text }),
      },
    };
  },

  /**
   * Map a raw Pangram-style JSON response into the app's { score, signals }.
   *
   * Example response shape (illustrative):
   *   {
   *     ai_likelihood: 0.94,               // 0..1 probability text is AI
   *     predicted_class: 'ai',             // 'ai' | 'human' | 'mixed'
   *     fraction_ai_content: 0.8,          // 0..1 portion of text flagged
   *     max_ai_likelihood_sentence: '...', // most AI-like sentence
   *   }
   *
   * @param {unknown} raw
   * @returns {{ score: number, signals: Array<{ label: string, detail: string }> }}
   */
  mapResponse(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const score = clampScore(Number(data.ai_likelihood) * 100);
    const signals = [];

    if (typeof data.predicted_class === 'string' && data.predicted_class) {
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

    const sentence =
      typeof data.max_ai_likelihood_sentence === 'string'
        ? data.max_ai_likelihood_sentence.trim()
        : '';
    if (sentence) {
      signals.push({ label: 'Most AI-like sentence', detail: sentence });
    }

    return { score, signals };
  },
};

// --- Hugging Face detector (free / open model) ------------------------------
// Calls a real AI-text-detection model through the Hugging Face Inference API
// (hf-inference provider). Free with a HF access token (read scope), which the
// user pastes into the options page — never hardcoded (§7). Enabled by default:
// with no token the service worker degrades to the local Stage-1 heuristic.
//
// Model: a general modern AI-text detector (labels Human/AI). Preferred over the
// older HC3 ChatGPT-Q&A detector, which misjudged out-of-distribution marketing
// copy as human. Still a free model — imperfect on short social posts; swap to
// Pangram (paid) for best accuracy.
const HF_MODEL = 'fakespot-ai/roberta-base-ai-text-detection-v1';

export const huggingfaceProvider = {
  id: 'huggingface',
  label: 'Hugging Face AI-text detector (free)',
  enabled: true,
  // chrome.storage.local key for the HF access token (set via the options page).
  apiKeyStorageKey: 'hfToken',
  model: HF_MODEL,
  endpoint: `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`,

  /**
   * @param {string} text   the post body to classify
   * @param {string} apiKey a Hugging Face access token (read scope)
   * @returns {{ url: string, options: RequestInit }}
   */
  buildRequest(text, apiKey) {
    return {
      url: this.endpoint,
      options: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        // Cap length for latency; wait_for_model avoids a 503 on cold start.
        body: JSON.stringify({
          inputs: String(text).slice(0, 4000),
          options: { wait_for_model: true },
        }),
      },
    };
  },

  /**
   * Map a HF text-classification response into { score, signals }.
   * Shape: [[{ label, score }, ...]] (or [{ label, score }, ...]). Labels vary by
   * model (Human/ChatGPT, Real/Fake, LABEL_0/LABEL_1), so we detect them by name.
   * @param {unknown} raw
   * @returns {{ score: number, signals: Array<{ label: string, detail: string }> }}
   */
  mapResponse(raw) {
    const rows = Array.isArray(raw) ? (Array.isArray(raw[0]) ? raw[0] : raw) : [];
    const scores = rows
      .filter((r) => r && typeof r.label === 'string' && Number.isFinite(Number(r.score)))
      .map((r) => ({ label: r.label, score: Number(r.score) }));
    if (!scores.length) return { ...NEUTRAL_RESULT };

    const aiRe = /chatgpt|\bai\b|fake|machine|generated|gpt|label[_-]?1/i;
    const humanRe = /human|real|label[_-]?0/i;
    const ai = scores.find((s) => aiRe.test(s.label));
    const human = scores.find((s) => humanRe.test(s.label));

    let aiProb;
    if (ai) aiProb = ai.score;
    else if (human) aiProb = 1 - human.score;
    else aiProb = scores.length > 1 ? scores[1].score : scores[0].score; // assume 2nd = AI

    const score = clampScore(aiProb * 100);
    return {
      score,
      signals: [
        {
          label: 'AI-detection model',
          detail: `Hugging Face detector: ${score}% AI-likelihood.`,
        },
      ],
    };
  },
};

// --- Hosted backend (no user key) -------------------------------------------
// Calls our own serverless proxy (proxy/, deployed to Vercel), which holds the
// detection provider key server-side. This is the default so the published
// extension works with NO configuration. The backend URL is resolved at call
// time from chrome.storage.local (see backend.js), not baked in here, so it's
// overridable per-install. The proxy already returns the app's { score, signals }
// shape, so mapResponse just validates/clamps it.
export const hostedBackendProvider = {
  id: 'hosted',
  label: 'Authenticity Notes cloud (no key needed)',
  enabled: true,
  // No per-user API key — the backend holds the keys.
  apiKeyStorageKey: null,
  // Flags the service worker to resolve the backend URL and skip the key check.
  usesBackend: true,
  backendPath: '/api/detect',

  /**
   * @param {string} text        the post body to classify
   * @param {string} _apiKey     unused (backend holds keys)
   * @param {string} backendUrl  resolved base URL (no trailing slash)
   * @returns {{ url: string, options: RequestInit }}
   */
  buildRequest(text, _apiKey, backendUrl) {
    return {
      url: `${backendUrl}${this.backendPath}`,
      options: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: String(text).slice(0, 8000) }),
      },
    };
  },

  /**
   * The backend already returns { score, signals }. Validate + clamp, and treat
   * an { unavailable } payload as no-result so the card keeps the Stage-1 verdict.
   * @param {unknown} raw
   * @returns {{ score: number, signals: Array<{ label: string, detail: string }> }}
   */
  mapResponse(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    if (data.unavailable) return { ...NEUTRAL_RESULT };
    const score = clampScore(data.score);
    const signals = Array.isArray(data.signals)
      ? data.signals
          .filter((s) => s && typeof s.label === 'string' && typeof s.detail === 'string')
          .slice(0, 8)
          .map((s) => ({ label: String(s.label), detail: String(s.detail) }))
      : [];
    return { score, signals };
  },
};

// Registry of available providers, keyed by id. Add your own entry here.
export const PROVIDERS = Object.freeze({
  [hostedBackendProvider.id]: hostedBackendProvider,
  [huggingfaceProvider.id]: huggingfaceProvider,
  [pangramProvider.id]: pangramProvider,
});

// The active provider the service worker uses. Swap this to any PROVIDERS entry
// to change detection backends. Defaults to the hosted backend so the extension
// works with no user key; degrades to the local Stage-1 heuristic when the
// backend is unreachable/unconfigured.
export const PROVIDER = hostedBackendProvider;

/**
 * Normalise a raw provider response into the app's { score, signals } shape,
 * delegating to the given provider's mapper (defaults to the active provider).
 * @param {unknown} raw
 * @param {object} [provider]
 * @returns {{ score: number, signals: Array<{ label: string, detail: string }> }}
 */
export function mapResponse(raw, provider = PROVIDER) {
  if (!provider || typeof provider.mapResponse !== 'function') {
    return { ...NEUTRAL_RESULT };
  }
  return provider.mapResponse(raw);
}
