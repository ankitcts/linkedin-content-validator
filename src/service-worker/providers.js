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

// Registry of available providers, keyed by id. Add your own entry here.
export const PROVIDERS = Object.freeze({
  [pangramProvider.id]: pangramProvider,
});

// The active provider the service worker uses. Swap this to any PROVIDERS entry
// to change detection backends. Disabled by default (§7).
export const PROVIDER = pangramProvider;

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
