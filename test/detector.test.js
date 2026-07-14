import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// detector.js is a classic content script: it attaches to globalThis.LCV rather
// than exporting anything. To test it in isolation we evaluate its source inside
// a fresh vm context whose global has a stubbed `LCV = {}`, exactly as the
// content-script list would provide (constants.js runs first). We then exercise
// the LCV.detect / LCV.wordCount it installs.
const detectorSource = readFileSync(
  fileURLToPath(new URL('../src/content/detector.js', import.meta.url)),
  'utf8',
);

function loadDetector() {
  const sandbox = { LCV: {} };
  vm.createContext(sandbox);
  vm.runInContext(detectorSource, sandbox);
  return sandbox.LCV;
}

// Convenience: the set of signal labels detect() fired for `text`.
function labelsFor(LCV, text) {
  return LCV.detect(text).signals.map((s) => s.label);
}

// A control post with none of the tracked signals (varied sentence lengths, no
// stock phrases, no em-dashes, no triads, no emoji bullets, no contrastive
// cliche). Serves as the "obvious human" baseline.
const HUMAN_POST = [
  'I spent Saturday morning fixing the leaky faucet in our upstairs bathroom, and honestly it took',
  'way longer than I expected. Turns out the washer was completely worn out. My kid handed me the',
  'wrong wrench about six times before we finally got it. We celebrated with pancakes.',
].join(' ');

test('detect() contract: score is an integer within 0-100 for varied inputs', () => {
  const LCV = loadDetector();
  const samples = [
    '',
    '   ',
    HUMAN_POST,
    'Delve into the power of synergy — leverage seamless robust holistic paradigm shift now.',
    'It is not X, it is Y and here are the key takeaways: speed, quality, and trust.',
  ];
  for (const text of samples) {
    const { score } = LCV.detect(text);
    assert.ok(Number.isInteger(score), `score must be an integer for: ${JSON.stringify(text)}`);
    assert.ok(score >= 0 && score <= 100, `score out of bounds (${score})`);
  }
});

test('detect() returns { score: 0, signals: [] } for non-string / empty input', () => {
  const LCV = loadDetector();
  for (const bad of ['', '   ', null, undefined, 42, {}]) {
    const result = LCV.detect(bad);
    assert.equal(result.score, 0);
    assert.equal(result.signals.length, 0);
  }
});

test('detect() signals expose { label, detail } string pairs', () => {
  const LCV = loadDetector();
  const { signals } = LCV.detect(
    'Delve into the power of synergy to elevate and empower your team.',
  );
  assert.ok(signals.length > 0, 'expected at least one signal');
  for (const signal of signals) {
    assert.equal(typeof signal.label, 'string');
    assert.equal(typeof signal.detail, 'string');
    assert.ok(signal.label.length > 0 && signal.detail.length > 0);
  }
});

test('signal: AI-phrase lexicon fires on stock phrases, absent otherwise', () => {
  const LCV = loadDetector();
  const positive =
    'We must delve into the power of synergy and leverage a holistic paradigm shift.';
  const negative =
    'The dog ran across the yard chasing a red rubber ball for several long minutes.';
  assert.ok(labelsFor(LCV, positive).includes('AI-phrase lexicon'));
  assert.ok(!labelsFor(LCV, negative).includes('AI-phrase lexicon'));
});

test('signal: Em-dash density fires on repeated em-dashes, absent otherwise', () => {
  const LCV = loadDetector();
  const positive = 'This approach works — really — well, and I mean that quite sincerely today.';
  const negative = 'This approach works really well, and I mean that quite sincerely here today.';
  assert.ok(labelsFor(LCV, positive).includes('Em-dash density'));
  assert.ok(!labelsFor(LCV, negative).includes('Em-dash density'));
});

test('signal: Uniform sentence length fires on low-variation runs, absent otherwise', () => {
  const LCV = loadDetector();
  const positive =
    'I woke up early today. I made a cup of tea. I read the news online. I went for a run.';
  // High variance across four sentences keeps the coefficient of variation high.
  const negative =
    'Yes. I then wrote an extraordinarily long, winding sentence packed with clauses. No. Done.';
  assert.ok(labelsFor(LCV, positive).includes('Uniform sentence length'));
  assert.ok(!labelsFor(LCV, negative).includes('Uniform sentence length'));
});

test('signal: contrastive "it\'s not X, it\'s Y" fires on the cliche, absent otherwise', () => {
  const LCV = loadDetector();
  const label = '"It\'s not X, it\'s Y" construction';
  const positive = "It's not the tools, it's the mindset that ends up mattering most in the end.";
  const negative = 'The tools help, but the mindset is what ends up mattering most in the end.';
  assert.ok(labelsFor(LCV, positive).includes(label));
  assert.ok(!labelsFor(LCV, negative).includes(label));
});

test('signal: Rule-of-three phrasing fires on triadic lists, absent otherwise', () => {
  const LCV = loadDetector();
  const positive = 'Our team values speed, quality, and trust above almost everything else we do.';
  const negative =
    'Our team values quality above almost everything else that we choose to build here.';
  assert.ok(labelsFor(LCV, positive).includes('Rule-of-three phrasing'));
  assert.ok(!labelsFor(LCV, negative).includes('Rule-of-three phrasing'));
});

test('signal: Emoji-bullet structure fires on emoji-led lines, absent otherwise', () => {
  const LCV = loadDetector();
  const positive = '🚀 Dream big\n💡 Move fast\n✅ Ship it every single day without fail';
  const negative = 'Dream big.\nMove fast.\nShip it every single day without fail and keep going.';
  assert.ok(labelsFor(LCV, positive).includes('Emoji-bullet structure'));
  assert.ok(!labelsFor(LCV, negative).includes('Emoji-bullet structure'));
});

test('direction: obvious AI text scores far above obvious human text', () => {
  const LCV = loadDetector();
  const aiPost = [
    "In today's fast-paced world, it's important to note that we must delve into the power of",
    'synergy. Let’s unpack this — really — and elevate our mindset. It’s not about the tools,',
    "it's about the journey. We value speed, quality, and trust.",
    '🚀 Dream big\n💡 Move fast\n✅ Ship daily',
  ].join(' ');

  const ai = LCV.detect(aiPost);
  const human = LCV.detect(HUMAN_POST);

  assert.ok(ai.score > human.score, `expected AI (${ai.score}) > human (${human.score})`);
  assert.ok(ai.score >= 70, `obvious AI should land in the high band, got ${ai.score}`);
  assert.equal(human.score, 0, `obvious human baseline should score 0, got ${human.score}`);
  assert.ok(ai.signals.length >= 3, 'obvious AI text should surface several signals');
});

test('wordCount() counts whitespace-delimited tokens; 0 for empty / non-string', () => {
  const LCV = loadDetector();
  assert.equal(LCV.wordCount('hello world'), 2);
  assert.equal(LCV.wordCount('  one   two    three '), 3);
  assert.equal(LCV.wordCount('single'), 1);
  assert.equal(LCV.wordCount(''), 0);
  assert.equal(LCV.wordCount('   '), 0);
  assert.equal(LCV.wordCount(null), 0);
  assert.equal(LCV.wordCount(undefined), 0);
  assert.equal(LCV.wordCount(1234), 0);
});
