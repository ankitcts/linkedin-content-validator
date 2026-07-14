import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/service-worker/hash.js';

// Known SHA-256 vectors (lowercase hex). sha256() must return the standard
// digest so the Stage-2 content-hash cache keys are stable and portable.
test('sha256() matches the canonical vector for "abc"', async () => {
  assert.equal(
    await sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('sha256() matches the canonical vector for the empty string', async () => {
  assert.equal(
    await sha256(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

test('sha256() returns 64 lowercase hex chars and is deterministic', async () => {
  const digest = await sha256('The quick brown fox jumps over the lazy dog');
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  assert.equal(digest, await sha256('The quick brown fox jumps over the lazy dog'));
});
