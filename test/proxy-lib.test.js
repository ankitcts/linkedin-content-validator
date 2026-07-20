// Unit tests for the backend proxy's pure logic: the credibility JSON parser,
// Gemini grounding -> evidence mapping, and the detection provider chain's
// no-provider path. Live Gemini/HF calls are exercised in deployment, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCredibility, VERDICTS, CLAIM_STATUSES } from '../proxy/lib/credibility.js';
import { groundingEvidence } from '../proxy/lib/gemini.js';
import { runDetect } from '../proxy/lib/detect.js';

test('proxy parseCredibility parses a clean JSON response', () => {
  const out = parseCredibility(
    '{"verdict":"dicey","confidence":72,"claims":[{"claim":"X doubled revenue","status":"unverified","note":"no source"}],"summary":"Unsourced."}',
  );
  assert.equal(out.verdict, 'dicey');
  assert.equal(out.confidence, 72);
  assert.equal(out.claims.length, 1);
  assert.equal(out.claims[0].status, 'unverified');
});

test('proxy parseCredibility tolerates code fences and prose', () => {
  const out = parseCredibility(
    'Here:\n```json\n{"verdict":"authentic","confidence":90,"claims":[],"summary":"ok"}\n```\n',
  );
  assert.equal(out.verdict, 'authentic');
  assert.equal(out.confidence, 90);
});

test('proxy parseCredibility coerces invalid fields and clamps confidence', () => {
  const out = parseCredibility(
    '{"verdict":"totally-fake","confidence":500,"claims":[{"claim":"c","status":"bogus"}],"summary":1}',
  );
  assert.ok(VERDICTS.includes(out.verdict));
  assert.equal(out.verdict, 'mixed');
  assert.equal(out.confidence, 100);
  assert.ok(CLAIM_STATUSES.includes(out.claims[0].status));
  assert.equal(out.claims[0].status, 'unverified');
  assert.equal(out.summary, '');
});

test('proxy parseCredibility returns null on non-JSON', () => {
  assert.equal(parseCredibility('nope'), null);
  assert.equal(parseCredibility(''), null);
});

test('groundingEvidence maps web grounding chunks to { title, url }', () => {
  const ev = groundingEvidence({
    groundingChunks: [
      { web: { uri: 'https://a.com', title: 'A' } },
      { web: { uri: 'https://b.com' } },
      { notWeb: true },
    ],
  });
  assert.equal(ev.length, 2);
  assert.equal(ev[0].title, 'A');
  assert.equal(ev[0].url, 'https://a.com');
  assert.equal(ev[1].title, 'https://b.com'); // falls back to uri when no title
});

test('groundingEvidence caps the number of sources', () => {
  const chunks = Array.from({ length: 10 }, (_, i) => ({ web: { uri: `https://x${i}.com` } }));
  assert.equal(groundingEvidence({ groundingChunks: chunks }, 3).length, 3);
});

test('groundingEvidence handles null / missing grounding', () => {
  assert.deepEqual(groundingEvidence(null), []);
  assert.deepEqual(groundingEvidence({}), []);
});

test('runDetect returns null when no provider env keys are configured', async () => {
  delete process.env.PANGRAM_API_KEY;
  delete process.env.HF_TOKEN;
  delete process.env.GEMINI_API_KEY;
  assert.equal(await runDetect('some text'), null);
  assert.equal(await runDetect(''), null);
});
