// Calibration guard-rails for the detector. These pin the *buckets* (not exact
// scores) so weight/lexicon changes can't silently (a) start flagging casual
// human posts or (b) regress AI-styled posts back to "human". detector.js is a
// classic content script, so we evaluate it (with constants.js for THRESHOLDS)
// in a vm context against a stubbed global.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function loadDetector() {
  const context = { globalThis: {} };
  context.globalThis.LCV = {};
  vm.createContext(context);
  for (const rel of ['../src/content/constants.js', '../src/content/detector.js']) {
    vm.runInContext(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'), context);
  }
  return context.globalThis.LCV;
}

// Everyday human posts — none of the stylometric tells; must stay well clear of
// the "possibly AI-assisted" line so the extension doesn't accuse real people.
const CASUAL_HUMAN = [
  'We spent the weekend fixing the back fence because a couple of the posts had ' +
    'rotted through near the base. I dug them out and poured fresh concrete then let ' +
    'everything set overnight. The gate finally closes without dragging now. Our dog ' +
    'supervised from the porch the whole time and offered no help at all.',
  'Took the kids to the lake this morning before it got too hot. Packed sandwiches, ' +
    'forgot the sunscreen, paid for it later. Still, watching them try to skip stones ' +
    'for the first time made the sunburn worth it. We stayed until the clouds rolled in.',
];

// AI / "LinkedIn-voice" posts — a polished corporate post and a tell-heavy one.
// Both should reach at least the middle bucket.
const AI_STYLED = [
  // Real post captured from the live feed.
  'TCS has announced plans to convert 1% to 1.5% of its associates, translating to ' +
    'approximately 5,900 to 8,900 individuals, into forward-deployed AI engineers. The ' +
    'CEO’s perspective is noteworthy: he believes that AI will generate new business ' +
    'opportunities rather than diminish outsourcing. Forward-deployed engineers will be ' +
    'integrated within client operations, focusing on transforming fragile prototypes ' +
    'into functional systems instead of merely delivering a model and departing. This ' +
    'shift should be viewed as a genuine hiring signal rather than a layoff indication. ' +
    'The critical skill set in demand is not just about prompting a model but about ' +
    'integrating various AI systems into complex existing enterprise infrastructures. ' +
    'The title of forward-deployed engineer is emerging as a pivotal role in software.',
  'Let me break it down. In today’s fast-paced world, success is not just about working ' +
    'hard — it is about working smart.\n🚀 Embrace the journey.\n💡 Trust the process.\n' +
    '🙏 Stay humble, stay curious, and stay hungry.\nThe reality is, growth happens ' +
    'outside your comfort zone. Make no mistake: this is a game-changer. Let that sink in.',
  // Real corporate "broetry" marketing post (captured from the live feed):
  // one-line paragraphs, decorative emoji, hashtag cluster, engagement-bait CTA.
  'Football has a unique way of bringing people together. 🎪\n\n' +
    'As the world comes together to celebrate the games, we are celebrating the people ' +
    'who make our team better every day.\n\n' +
    'Across countries, cultures and roles, our people each bring something different.\n\n' +
    'So we asked a simple question:\n\n' +
    'If your role translated to a football organization, what position would you play?\n\n' +
    'The answers are as diverse as the countries we call home, but they all point to one ' +
    'thing: great teams succeed because everyone is committed to the role they play.\n\n' +
    '⚽ Swipe to meet part of our global squad!\n\n' +
    'What position would you play? Tell us in the comments. 👇\n\n' +
    '#WorldCup2026 #PublicisSapient #FIFAWorldCup',
];

test('casual human posts stay below the AI-assisted threshold (no false positives)', () => {
  const LCV = loadDetector();
  const threshold = LCV.THRESHOLDS.ASSISTED;
  for (const text of CASUAL_HUMAN) {
    const { score } = LCV.detect(text);
    assert.ok(
      score < threshold,
      `expected < ${threshold}, got ${score} for: ${text.slice(0, 48)}…`,
    );
  }
});

test('AI-styled posts reach at least the "possibly AI-assisted" bucket', () => {
  const LCV = loadDetector();
  const threshold = LCV.THRESHOLDS.ASSISTED;
  for (const text of AI_STYLED) {
    const { score } = LCV.detect(text);
    assert.ok(score >= threshold, `expected >= ${threshold}, got ${score}`);
  }
});
