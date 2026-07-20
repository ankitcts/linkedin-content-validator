// Tests for the extension's hosted-backend wiring: the default provider, its
// request building + response mapping, and backend URL resolution (default /
// override / disabled). chrome.storage.local and fetch are mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Controllable chrome.storage.local mock. backend.js reads it lazily (inside
// functions), so setting this before each test is enough.
let localStore = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const list = Array.isArray(keys)
          ? keys
          : typeof keys === 'string'
            ? [keys]
            : Object.keys(keys || {});
        const out = {};
        for (const k of list) if (k in localStore) out[k] = localStore[k];
        return out;
      },
    },
  },
};

const { getBackendUrl, DEFAULT_BACKEND_URL, backendCredibility } =
  await import('../src/service-worker/backend.js');
const { hostedBackendProvider, PROVIDER, NEUTRAL_RESULT } =
  await import('../src/service-worker/providers.js');

test('the active provider is the hosted backend and needs no key', () => {
  assert.equal(PROVIDER.id, 'hosted');
  assert.equal(PROVIDER.enabled, true);
  assert.equal(PROVIDER.usesBackend, true);
  assert.equal(PROVIDER.apiKeyStorageKey, null);
});

test('getBackendUrl defaults when nothing is stored', async () => {
  localStore = {};
  assert.equal(await getBackendUrl(), DEFAULT_BACKEND_URL);
});

test('getBackendUrl uses the override and strips trailing slashes', async () => {
  localStore = { backendUrl: 'https://my-proxy.example.com/' };
  assert.equal(await getBackendUrl(), 'https://my-proxy.example.com');
});

test('getBackendUrl falls back to default when the override is blank', async () => {
  localStore = { backendUrl: '   ' };
  assert.equal(await getBackendUrl(), DEFAULT_BACKEND_URL);
});

test('getBackendUrl returns empty string when the backend is disabled', async () => {
  localStore = { backendDisabled: true, backendUrl: 'https://my-proxy.example.com' };
  assert.equal(await getBackendUrl(), '');
});

test('buildRequest targets the backend /api/detect with a JSON text body', () => {
  const { url, options } = hostedBackendProvider.buildRequest(
    'hello world',
    '',
    'https://proxy.example.com',
  );
  assert.equal(url, 'https://proxy.example.com/api/detect');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['content-type'], 'application/json');
  assert.match(options.body, /"text":"hello world"/);
});

test('mapResponse passes through and clamps a backend { score, signals }', () => {
  const r = hostedBackendProvider.mapResponse({
    score: 140,
    signals: [{ label: 'AI-detection model', detail: '88% AI-likelihood.' }],
  });
  assert.equal(r.score, 100);
  assert.equal(r.signals.length, 1);
  assert.equal(r.signals[0].label, 'AI-detection model');
});

test('mapResponse drops malformed signals', () => {
  const r = hostedBackendProvider.mapResponse({
    score: 50,
    signals: [{ label: 'ok', detail: 'good' }, { label: 123 }, null, 'nope'],
  });
  assert.equal(r.signals.length, 1);
});

test('mapResponse treats an { unavailable } payload as neutral', () => {
  const r = hostedBackendProvider.mapResponse({ unavailable: true, reason: 'no-provider' });
  assert.equal(r.score, NEUTRAL_RESULT.score);
  assert.equal(r.signals.length, 0);
});

test('backendCredibility returns the parsed result on success', async () => {
  globalThis.fetch = async (url, opts) => {
    assert.match(url, /\/api\/credibility$/);
    assert.equal(opts.method, 'POST');
    return {
      ok: true,
      json: async () => ({
        verdict: 'authentic',
        confidence: 90,
        claims: [],
        summary: 'ok',
        evidence: [],
      }),
    };
  };
  const r = await backendCredibility('https://proxy.example.com', 'some post text');
  assert.equal(r.verdict, 'authentic');
  assert.equal(r.confidence, 90);
});

test('backendCredibility maps an HTTP error to unavailable', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
  const r = await backendCredibility('https://proxy.example.com', 't');
  assert.equal(r.unavailable, true);
  assert.equal(r.reason, 'http-502');
});

test('backendCredibility surfaces an { unavailable } payload reason', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ unavailable: true, reason: 'no-key' }),
  });
  const r = await backendCredibility('https://proxy.example.com', 't');
  assert.equal(r.unavailable, true);
  assert.equal(r.reason, 'no-key');
});
