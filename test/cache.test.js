import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getCached, setCached } from '../src/service-worker/cache.js';

// cache.js talks to chrome.storage.local. cache.js only touches the global at
// call time (not on import), so we install an in-memory stub before exercising
// it. Each test resets the backing store for isolation.
let store;

beforeEach(() => {
  store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (obj) => {
          Object.assign(store, obj);
        },
      },
    },
  };
});

test('setCached() then getCached() round-trips the stored result', async () => {
  const hash = 'a'.repeat(64);
  const result = {
    score: 82,
    signals: [{ label: 'AI-phrase lexicon', detail: '3 stock phrases' }],
  };
  await setCached(hash, result);
  assert.deepEqual(await getCached(hash), result);
});

test('getCached() returns null on a cache miss', async () => {
  assert.equal(await getCached('b'.repeat(64)), null);
});

test('setCached() writes under the hash key and does not clobber other entries', async () => {
  await setCached('hash-one', { score: 1, signals: [] });
  await setCached('hash-two', { score: 2, signals: [] });
  assert.deepEqual(await getCached('hash-one'), { score: 1, signals: [] });
  assert.deepEqual(await getCached('hash-two'), { score: 2, signals: [] });
  assert.equal(await getCached('hash-three'), null);
});
