// Unit tests for the Stage-2 provider layer — focused on the Hugging Face
// detector's request building and response mapping (the parts most likely to
// break against the live API). providers.js is a pure ESM module, imported
// directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  huggingfaceProvider,
  hostedBackendProvider,
  mapResponse,
  PROVIDER,
  NEUTRAL_RESULT,
} from '../src/service-worker/providers.js';

test('the active provider is the hosted backend (key-free) by default', () => {
  assert.equal(PROVIDER.id, 'hosted');
  assert.equal(PROVIDER, hostedBackendProvider);
  assert.equal(PROVIDER.enabled, true);
});

test('the free Hugging Face detector remains available as an alternate', () => {
  assert.equal(huggingfaceProvider.enabled, true);
  assert.equal(huggingfaceProvider.apiKeyStorageKey, 'hfToken');
});

test('buildRequest targets the HF router with a bearer token and inputs', () => {
  const { url, options } = huggingfaceProvider.buildRequest('hello world', 'hf_secret');
  assert.match(url, /^https:\/\/router\.huggingface\.co\/hf-inference\/models\//);
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.authorization, 'Bearer hf_secret');
  assert.match(options.body, /"inputs":"hello world"/);
});

test('buildRequest caps very long input length', () => {
  const { options } = huggingfaceProvider.buildRequest('x'.repeat(10000), 'hf_x');
  const { inputs } = JSON.parse(options.body);
  assert.equal(inputs.length, 4000);
});

test('mapResponse: ChatGPT-labeled result -> high AI score', () => {
  const r = huggingfaceProvider.mapResponse([
    [
      { label: 'ChatGPT', score: 0.94 },
      { label: 'Human', score: 0.06 },
    ],
  ]);
  assert.equal(r.score, 94);
  assert.ok(r.signals.length >= 1);
  assert.match(r.signals[0].detail, /94%/);
});

test('mapResponse: Human-labeled result -> low AI score', () => {
  const r = huggingfaceProvider.mapResponse([
    [
      { label: 'Human', score: 0.9 },
      { label: 'ChatGPT', score: 0.1 },
    ],
  ]);
  assert.equal(r.score, 10);
});

test('mapResponse: LABEL_0 / LABEL_1 scheme treats LABEL_1 as AI', () => {
  const r = huggingfaceProvider.mapResponse([
    [
      { label: 'LABEL_0', score: 0.2 },
      { label: 'LABEL_1', score: 0.8 },
    ],
  ]);
  assert.equal(r.score, 80);
});

test('mapResponse: accepts a flat (non-nested) array too', () => {
  const r = huggingfaceProvider.mapResponse([
    { label: 'Real', score: 0.7 },
    { label: 'Fake', score: 0.3 },
  ]);
  assert.equal(r.score, 30); // Fake == AI
});

test('mapResponse: AI / Human labels (fakespot model) -> AI score', () => {
  const r = huggingfaceProvider.mapResponse([
    [
      { label: 'AI', score: 0.82 },
      { label: 'Human', score: 0.18 },
    ],
  ]);
  assert.equal(r.score, 82);
});

test('mapResponse: garbage / error payload degrades to neutral', () => {
  const r = huggingfaceProvider.mapResponse({ error: 'Model is currently loading' });
  assert.equal(r.score, NEUTRAL_RESULT.score);
  assert.equal(r.signals.length, 0);
});

test('top-level mapResponse delegates to the active (hosted) provider', () => {
  const r = mapResponse({ score: 88, signals: [{ label: 'x', detail: 'y' }] });
  assert.equal(r.score, 88);
});

test('top-level mapResponse can target an explicit provider (HF)', () => {
  const r = mapResponse([[{ label: 'ChatGPT', score: 0.88 }]], huggingfaceProvider);
  assert.equal(r.score, 88);
});
