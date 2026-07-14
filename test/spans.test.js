// Unit tests for the detector's flagged-passage spans (used for in-post
// highlighting). detector.js is a classic content script that assigns to
// globalThis.LCV, so we evaluate it in a vm context with a stubbed global.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function loadDetector() {
  const src = readFileSync(
    fileURLToPath(new URL('../src/content/detector.js', import.meta.url)),
    'utf8',
  );
  const context = { globalThis: {} };
  context.globalThis.LCV = {};
  vm.createContext(context);
  vm.runInContext(src, context);
  return context.globalThis.LCV;
}

test('detect() returns exact-cased spans for phrase and clause signals', () => {
  const LCV = loadDetector();
  const text =
    'At the end of the day, we must adapt. Here are three things I learned: ' +
    'resilience, curiosity, and grit. Let that sink in.';
  const { spans } = LCV.detect(text);

  assert.ok(Array.isArray(spans) && spans.length >= 2, 'should surface flagged passages');

  // Every span must be an exact substring of the input so the content script can
  // locate it as a Range for highlighting.
  for (const span of spans) {
    assert.ok(text.includes(span.text), `span must be a substring: ${span.text}`);
    assert.equal(typeof span.reason, 'string');
    assert.ok(span.reason.length > 0);
  }

  const texts = spans.map((s) => s.text);
  assert.ok(
    texts.some((t) => /at the end of the day/i.test(t)),
    'stock-phrase passage flagged',
  );
  assert.ok(
    texts.some((t) => /resilience, curiosity, and grit/i.test(t)),
    'rule-of-three passage flagged',
  );
});

test('detect() returns no spans for plain human text', () => {
  const LCV = loadDetector();
  const { spans } = LCV.detect(
    'We fixed the fence this weekend after a couple of posts rotted through near the base.',
  );
  // spans is created in the vm realm, so compare by length rather than deepEqual
  // (which would reject on a cross-realm Array.prototype mismatch).
  assert.equal(spans.length, 0);
});

test('spans are deduplicated and capped', () => {
  const LCV = loadDetector();
  const repeated = Array.from({ length: 20 }, () => 'At the end of the day, things change.').join(
    ' ',
  );
  const { spans } = LCV.detect(repeated);
  assert.ok(spans.length <= 12, 'spans are capped');
  const unique = new Set(spans.map((s) => s.text));
  assert.equal(unique.size, spans.length, 'no duplicate span texts');
});
