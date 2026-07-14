// Integration test: drives the REAL content-script pipeline end-to-end against a
// LinkedIn-shaped DOM fixture, in the same order the manifest loads them
// (constants -> selectors -> detector -> card -> index). This validates the
// pieces unit tests can't touch in isolation:
//   - the SELECTORS actually match a realistic post structure
//   - the IntersectionObserver -> detect -> renderCard -> inject flow runs
//   - MIN_WORDS and the sensitivity threshold gate correctly
//   - the Stage-2 deep-check message is sent and upgrades the card in place
//
// It is NOT a substitute for validating selectors against the live, authenticated
// LinkedIn feed (which needs a real logged-in browser) — the fixture mirrors the
// post markup the SELECTORS target, so a LinkedIn DOM change still requires a
// manual re-check. But it catches regressions in our own wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const CONTENT_SCRIPTS = [
  '../src/content/constants.js',
  '../src/content/selectors.js',
  '../src/content/detector.js',
  '../src/content/card.js',
  '../src/content/index.js',
].map((rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

// Known-scoring inputs (verified against the detector): the AI-looking post fires
// several stylometric signals; the human post fires none.
const AI_POST =
  'I am thrilled to share a lesson that changed my career. It is not just about ' +
  'working hard, it is about working smart. Here are three things I learned: ' +
  'resilience, curiosity, and grit. In today’s fast-paced world, we must ' +
  'embrace change — and lean into discomfort — to unlock our true ' +
  'potential. Let that sink in.';
const HUMAN_POST =
  'We spent the weekend fixing the back fence because a couple of the posts had ' +
  'rotted through near the base. I dug them out and poured fresh concrete then let ' +
  'everything set overnight. The gate finally closes without dragging now. Our dog ' +
  'supervised from the porch the whole time and offered no help at all.';
const SHORT_POST = 'Quick update: we shipped the new feature today and it went well.';

function postMarkup(activityId, text) {
  return `
    <div class="feed-shared-update-v2" data-id="urn:li:activity:${activityId}">
      <div class="feed-shared-update-v2__description-wrapper">
        <div class="update-components-text">${text}</div>
      </div>
      <div class="social-details-social-actions">Like · Comment · Repost</div>
    </div>`;
}

function buildFeed(posts, deepCheckResponse) {
  const html = `<!doctype html><html><body><main id="feed">
    ${posts.map((p, i) => postMarkup(String(i + 1), p)).join('\n')}
  </main></body></html>`;

  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  // jsdom has no IntersectionObserver — mock it and expose a manual trigger.
  const ioInstances = [];
  class MockIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      ioInstances.push(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    unobserve(target) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
    }
    takeRecords() {
      return [];
    }
  }
  window.IntersectionObserver = MockIntersectionObserver;
  window.__fireIntersections = () => {
    for (const inst of ioInstances) {
      const entries = [...inst.targets].map((target) => ({ isIntersecting: true, target }));
      inst.callback(entries, inst);
    }
  };

  if (typeof window.requestAnimationFrame !== 'function') {
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  }

  const sentMessages = [];
  window.chrome = {
    runtime: {
      lastError: null,
      getURL: (path) => `chrome-extension://test/${path}`,
      sendMessage: (message, cb) => {
        sentMessages.push(message);
        if (typeof cb === 'function') Promise.resolve().then(() => cb(deepCheckResponse));
      },
      onMessage: { addListener: () => {} },
      openOptionsPage: () => {},
    },
    storage: {
      sync: {
        get: (defaults) =>
          Promise.resolve({ ...defaults, enabled: true, scanMode: 'auto', sensitivity: 15 }),
        set: () => Promise.resolve(),
      },
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      onChanged: { addListener: () => {} },
    },
    tabs: { query: () => Promise.resolve([]), sendMessage: () => {} },
  };

  for (const src of CONTENT_SCRIPTS) window.eval(src);
  return { window, sentMessages };
}

// Flush pending microtasks + timers (settings load, deep-check callback).
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const cardHost = (post) => post.querySelector('[data-lcv-card]');

test('injects an evidence card for an AI-looking post and upgrades it via Stage-2', async () => {
  const { window, sentMessages } = buildFeed([AI_POST], {
    score: 78,
    signals: [{ label: 'Model verdict', detail: 'Classified as AI-generated.' }],
  });
  await flush(); // settings load from storage
  window.__fireIntersections();
  await flush(); // Stage-2 deep-check callback

  const aiPost = window.document.querySelectorAll('.feed-shared-update-v2')[0];
  const host = cardHost(aiPost);
  assert.ok(host, 'AI post should receive a context card');

  const card = host.shadowRoot.querySelector('.lcv-card');
  assert.ok(card, 'card body should render inside the shadow root');
  assert.equal(card.dataset.state, 'verified', 'card should upgrade to verified after Stage-2');

  const chip = card.querySelector('.lcv-chip');
  assert.ok(chip && chip.textContent.trim().length > 0, 'verdict chip should have a label');

  const signals = card.querySelectorAll('.lcv-signal');
  assert.ok(signals.length >= 1, 'card should list at least one evidence signal');

  assert.ok(
    card.querySelector('.lcv-disclaimer'),
    'card must always show the probabilistic disclaimer',
  );

  // Exactly one Stage-2 request — only the AI post cleared the sensitivity gate.
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'deep-check');
});

test('does not card a human post below the sensitivity threshold', async () => {
  const { window, sentMessages } = buildFeed([HUMAN_POST], { score: 50, signals: [] });
  await flush();
  window.__fireIntersections();
  await flush();

  const humanPost = window.document.querySelectorAll('.feed-shared-update-v2')[0];
  assert.equal(cardHost(humanPost), null, 'human-looking post should not be carded');
  assert.equal(sentMessages.length, 0, 'no Stage-2 request for a gated post');
});

test('does not score posts shorter than MIN_WORDS', async () => {
  const { window } = buildFeed([SHORT_POST], { score: 50, signals: [] });
  await flush();
  window.__fireIntersections();
  await flush();

  const shortPost = window.document.querySelectorAll('.feed-shared-update-v2')[0];
  assert.equal(cardHost(shortPost), null, 'short post should be skipped');
});
