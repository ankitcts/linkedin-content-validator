// Unit tests for the Stage-3 credibility pipeline's pure logic: search-query
// building, prompt construction, LLM request/response shaping, and the tolerant
// JSON parser. (The live search + LLM calls run in the service worker and are
// verified in-browser.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, parseCredibility } from '../src/service-worker/credibility.js';
import { buildSearchQuery } from '../src/service-worker/search.js';
import { LLM_PROVIDER } from '../src/service-worker/llm.js';

test('buildSearchQuery strips urls, hashtags, punctuation and caps length', () => {
  const q = buildSearchQuery('Big news!! Visit https://x.com/y #Hype @acme — 50% growth???');
  assert.ok(!/https?:/.test(q), 'no urls');
  assert.ok(!q.includes('#'), 'no hashtags');
  assert.ok(!/[!?—%]/.test(q), 'no punctuation');
  assert.ok(q.length <= 200);
  assert.match(q, /Big news/);
});

test('buildMessages embeds the post text and evidence snippets', () => {
  const msgs = buildMessages('TCS will hire 5000 engineers', [
    { title: 'TCS', snippet: 'Tata Consultancy Services is an IT firm.' },
  ]);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].role, 'user');
  assert.match(msgs[1].content, /TCS will hire 5000 engineers/);
  assert.match(msgs[1].content, /Tata Consultancy Services/);
});

test('buildMessages notes when there is no evidence', () => {
  const msgs = buildMessages('some post text', []);
  assert.match(msgs[1].content, /no reference snippets/i);
});

test('parseCredibility parses a clean JSON response', () => {
  const out = parseCredibility(
    '{"verdict":"dicey","confidence":72,"claims":[{"claim":"X doubled revenue","status":"unverified","note":"no source"}],"summary":"Unsourced claim."}',
  );
  assert.equal(out.verdict, 'dicey');
  assert.equal(out.confidence, 72);
  assert.equal(out.claims.length, 1);
  assert.equal(out.claims[0].status, 'unverified');
  assert.equal(out.summary, 'Unsourced claim.');
});

test('parseCredibility tolerates code fences and surrounding prose', () => {
  const out = parseCredibility(
    'Sure:\n```json\n{"verdict":"authentic","confidence":90,"claims":[],"summary":"ok"}\n```\nHope that helps!',
  );
  assert.equal(out.verdict, 'authentic');
  assert.equal(out.confidence, 90);
});

test('parseCredibility coerces invalid fields and clamps confidence', () => {
  const out = parseCredibility(
    '{"verdict":"totally-fake","confidence":500,"claims":[{"claim":"c","status":"bogus"}],"summary":1}',
  );
  assert.equal(out.verdict, 'mixed');
  assert.equal(out.confidence, 100);
  assert.equal(out.claims[0].status, 'unverified');
  assert.equal(out.summary, '');
});

test('parseCredibility returns null on non-JSON', () => {
  assert.equal(parseCredibility('I cannot help with that.'), null);
  assert.equal(parseCredibility(''), null);
});

test('LLM buildRequest targets the router with bearer token and model override', () => {
  const { url, options } = LLM_PROVIDER.buildRequest(
    [{ role: 'user', content: 'hi' }],
    'hf_x',
    'my/model',
  );
  assert.match(url, /router\.huggingface\.co\/v1\/chat\/completions/);
  assert.equal(options.headers.authorization, 'Bearer hf_x');
  const body = JSON.parse(options.body);
  assert.equal(body.model, 'my/model');
  assert.equal(body.messages[0].content, 'hi');
});

test('LLM parseContent extracts the assistant message text', () => {
  assert.equal(
    LLM_PROVIDER.parseContent({ choices: [{ message: { content: 'hello' } }] }),
    'hello',
  );
  assert.equal(LLM_PROVIDER.parseContent({}), '');
});
