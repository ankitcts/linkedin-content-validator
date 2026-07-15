// Pluggable LLM provider for the credibility analysis (Stage-3).
//
// Uses an OpenAI-compatible chat-completions API so swapping the model — or the
// whole backend (Claude, OpenAI, a local server) — is a one-object config change.
// Default is a free Hugging Face-hosted instruct model via the HF router, keyed
// by the same HF token as the detector (chrome.storage.local 'hfToken'). The API
// key is never hardcoded (§7).
//
// NOTE: free HF LLM availability varies; if the default model isn't reachable,
// set a different model in the options page. The pipeline degrades gracefully.
const HF_LLM_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';

export const huggingfaceLLM = {
  id: 'hf-llm',
  label: 'Hugging Face LLM (free)',
  apiKeyStorageKey: 'hfToken',
  // Overridable via chrome.storage.local 'llmModel' (options page).
  modelStorageKey: 'llmModel',
  defaultModel: HF_LLM_MODEL,
  endpoint: 'https://router.huggingface.co/v1/chat/completions',

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @param {string} apiKey
   * @param {string} [model]
   * @returns {{ url: string, options: RequestInit }}
   */
  buildRequest(messages, apiKey, model) {
    return {
      url: this.endpoint,
      options: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || this.defaultModel,
          messages,
          max_tokens: 700,
          temperature: 0.2,
        }),
      },
    };
  },

  /** Extract the assistant message text from an OpenAI-style chat response. */
  parseContent(raw) {
    const choice = raw && Array.isArray(raw.choices) ? raw.choices[0] : null;
    const content = choice && choice.message ? choice.message.content : '';
    return typeof content === 'string' ? content : '';
  },
};

export const LLM_PROVIDER = huggingfaceLLM;
