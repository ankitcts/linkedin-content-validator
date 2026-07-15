// Integration test: drives the REAL content-script pipeline end-to-end against a
// LinkedIn-shaped DOM fixture, in the same order the manifest loads them
// (constants -> selectors -> detector -> card -> index). This validates the
// pieces unit tests can't touch in isolation:
//   - the SELECTORS match LinkedIn's current markup (hashed classes + the stable
//     [data-testid="expandable-text-box"] hook)
//   - the IntersectionObserver -> detect -> renderCard -> inject flow runs
//   - MIN_WORDS and the sensitivity threshold gate correctly
//   - the Stage-2 deep-check message is sent and upgrades the card in place
//
// The fixture mirrors the real feed markup (captured 2026-07 from a live feed:
// hashed per-build class names, an <h2>Feed post</h2>, and the post body in a
// <p><span data-testid="expandable-text-box">). It is still not a substitute for
// a manual check on the live feed, but it catches regressions in our wiring and
// pins the selector contract to the real DOM shape.
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

// A real, polished LinkedIn post (captured from the live feed). Contains the
// contrastive "not just about X but about Y" construction and "pivotal".
const REAL_POST =
  'TCS has announced plans to convert 1% to 1.5% of its associates, translating to ' +
  'approximately 5,900 to 8,900 individuals, into forward-deployed AI engineers. The ' +
  'CEO’s perspective is noteworthy: he believes that AI will generate new business ' +
  'opportunities rather than diminish outsourcing. Forward-deployed engineers will be ' +
  'integrated within client operations, focusing on transforming fragile prototypes into ' +
  'functional systems instead of merely delivering a model and departing. This shift ' +
  'should be viewed as a genuine hiring signal rather than a layoff indication. The ' +
  'critical skill set in demand is not just about prompting a model but about integrating ' +
  'various AI systems into complex existing enterprise infrastructures. The title of ' +
  'forward-deployed engineer is emerging as a pivotal role in enterprise software.';

// Faithful to LinkedIn's current feed markup: hashed, per-build class names plus
// the stable data-testid hook our SELECTORS key off. The body text lives in a
// <span data-testid="expandable-text-box"> inside a <p>; the card anchors after
// that <p>.
function postMarkup(id, text) {
  return `
    <article data-testpost="${id}">
      <div class="_205b22a0 a214530a e5658197"><h2 class="_8444b62f"><span>Feed post</span></h2></div>
      <p class="_8444b62f fa31a8fc _67661a5a" componentkey="body-${id}"><span class="bdc52b98 _12eb2009 _84b09c55" tabindex="-1" data-testid="expandable-text-box">${text}</span></p>
      <div class="_3c0e8b9a _545e5fe8">102 reactions</div>
    </article>`;
}

function buildFeed(posts, deepCheckResponse, options = {}) {
  const html = `<!doctype html><html><body><main id="feed">
    ${posts.map((p, i) => postMarkup(String(i + 1), p)).join('\n')}
  </main></body></html>`;

  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  // jsdom lacks the CSS Custom Highlight API; mock it so we can assert that
  // flagged passages get highlighted via Ranges (no DOM mutation).
  if (options.highlightApi) {
    window.CSS = { highlights: new Map() };
    window.Highlight = class Highlight {
      constructor() {
        this.ranges = [];
      }
      add(range) {
        this.ranges.push(range);
      }
    };
  }

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

const posts = (window) => window.document.querySelectorAll('[data-testpost]');
const cardHost = (post) => post.querySelector('[data-lcv-card]');

test('injects an evidence card for an AI-looking post and upgrades it via Stage-2', async () => {
  const { window, sentMessages } = buildFeed([AI_POST], {
    score: 78,
    signals: [{ label: 'Model verdict', detail: 'Classified as AI-generated.' }],
  });
  await flush(); // settings load from storage
  window.__fireIntersections();
  await flush(); // Stage-2 deep-check callback

  const host = cardHost(posts(window)[0]);
  assert.ok(host, 'AI post should receive a context card');

  const card = host.shadowRoot.querySelector('.lcv-card');
  assert.ok(card, 'card body should render inside the shadow root');
  assert.equal(card.dataset.state, 'verified', 'card should upgrade to verified after Stage-2');

  // CSS is inlined into the shadow root (no chrome.runtime.getURL link).
  assert.ok(host.shadowRoot.querySelector('style'), 'card CSS should be inlined as <style>');
  assert.equal(host.shadowRoot.querySelector('link'), null, 'no external <link> stylesheet');

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

test('cards a real, polished LinkedIn post captured from the live feed', async () => {
  const { window, sentMessages } = buildFeed([REAL_POST], { score: 64, signals: [] });
  await flush();
  window.__fireIntersections();
  await flush();

  const post = posts(window)[0];
  // Selector actually found the body text in the real markup shape.
  const textEl = post.querySelector('[data-testid="expandable-text-box"]');
  assert.ok(textEl && /TCS has announced/.test(textEl.textContent), 'body text extracted');

  const host = cardHost(post);
  assert.ok(host, 'a real AI-styled post should be carded');
  assert.equal(sentMessages.length, 1, 'Stage-2 requested for the carded post');
});

test('does not card a human post below the sensitivity threshold', async () => {
  const { window, sentMessages } = buildFeed([HUMAN_POST], { score: 50, signals: [] });
  await flush();
  window.__fireIntersections();
  await flush();

  assert.equal(cardHost(posts(window)[0]), null, 'human-looking post should not be carded');
  assert.equal(sentMessages.length, 0, 'no Stage-2 request for a gated post');
});

test('does not score posts shorter than MIN_WORDS', async () => {
  const { window } = buildFeed([SHORT_POST], { score: 50, signals: [] });
  await flush();
  window.__fireIntersections();
  await flush();

  assert.equal(cardHost(posts(window)[0]), null, 'short post should be skipped');
});

test('highlights flagged passages in the post without mutating its text DOM', async () => {
  const { window } = buildFeed([AI_POST], { score: 78, signals: [] }, { highlightApi: true });
  await flush();
  window.__fireIntersections();
  await flush();

  const highlight = window.CSS.highlights.get('lcv-ai-flag');
  assert.ok(highlight, 'a highlight registry entry should be created');
  assert.ok(highlight.ranges.length >= 1, 'at least one flagged passage should be highlighted');

  // The page-level ::highlight() style is injected exactly once.
  assert.ok(window.document.getElementById('lcv-highlight-style'), 'highlight style injected');

  // Highlighting uses Ranges, so the post's own text node is neither wrapped
  // nor split — LinkedIn's DOM is left intact.
  const textEl = window.document.querySelector('[data-testid="expandable-text-box"]');
  assert.equal(textEl.childNodes.length, 1, 'post text node should not be wrapped/split');
  assert.equal(textEl.textContent, AI_POST, 'post text content unchanged');
});
