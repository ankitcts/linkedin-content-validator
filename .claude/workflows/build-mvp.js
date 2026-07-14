export const meta = {
  name: 'build-mvp',
  description:
    'Implement the LinkedIn Authenticity Notes MVP: fan out UI, Stage-1 detector, and Stage-2 pipeline in parallel (disjoint file ownership), then write tests and validate.',
  phases: [
    { title: 'Build', detail: 'UI, Stage-1 detector, Stage-2 pipeline in parallel' },
    { title: 'Test', detail: 'real tests + lint/format/test validation' },
  ],
};

const REPO = '/workspace/linkedin-content-validator';

const shared = `You are working in the Chrome MV3 extension repo at ${REPO}
(branch claude/linkedin-content-validator-repo-60pgk7).

Read PROJECT_CONTEXT.md (§4 architecture, §5 card UI spec, §7 principles) and README.md first.

Contracts (do not break):
- Stage-1: globalThis.LCV.detect(text) -> { score: 0-100, signals: [{ label, detail }] }
- DOM via globalThis.LCV.SELECTORS only; gate on LCV.MIN_WORDS; map score via LCV.THRESHOLDS + LCV.VERDICTS
- Stage-2: chrome.runtime.sendMessage({ type: 'deep-check', text }) -> { score, signals }

Rules: Do NOT run git. Do NOT edit files outside your ownership list. Do NOT hardcode API keys.
Keep code lint/Prettier clean (single quotes, semicolons, printWidth 100). Dependencies are
already installed - use npm run lint / npm test only to check your own work. Return a concise
summary (files changed + key decisions).`;

phase('Build');
const build = await parallel([
  () =>
    agent(
      `${shared}

ROLE: UI engineer. OWN ONLY: src/content/index.js, src/content/card.js, src/content/card.css, src/popup/*, src/options/*.
Implement the Shadow-DOM Community Notes card (§5) in card.js/card.css. Wire content/index.js:
MutationObserver (feed) + IntersectionObserver (+200px root margin) to detect posts entering view,
extract text via LCV.SELECTORS, gate on LCV.MIN_WORDS, run LCV.detect for the instant Stage-1 card,
inject it after the description and before the reaction bar, then request Stage-2 via
chrome.runtime.sendMessage and upgrade the card in place (preliminary -> verified). Build the popup
(enable/disable + link to options) and the options page (sensitivity threshold, provider API key,
auto vs on-demand) wired to chrome.storage. Assume LCV.detect and the service worker already satisfy
the contracts above.`,
      { label: 'ui', phase: 'Build', agentType: 'ui-engineer' },
    ),
  () =>
    agent(
      `${shared}

ROLE: Stage-1 detector (ML validation). OWN ONLY: src/content/detector.js, src/content/constants.js.
Implement LCV.detect(text) with the §4 stylometric signals: AI-phrase lexicon, em-dash density,
sentence-length uniformity (coefficient of variation < 0.42), "it's not X, it's Y", rule-of-three
lists, emoji-bullet structure. Combine into a 0-100 score with the firing signals ([{label, detail}]).
Add a wordCount(text) helper on LCV. Pure, deterministic, no DOM, no network. Keep detector.js a valid
classic script (attaches to globalThis.LCV; no export/module.exports) so it stays testable via a
stubbed global.`,
      { label: 'detector', phase: 'Build', agentType: 'detector-ml-engineer' },
    ),
  () =>
    agent(
      `${shared}

ROLE: Stage-2 deep-check pipeline (ML verification). OWN ONLY: src/service-worker/index.js,
src/service-worker/providers.js, src/service-worker/cache.js, src/service-worker/hash.js.
Implement the onMessage handler for { type: 'deep-check', text }: sha256(text) -> getCached(hash) ->
on miss, if PROVIDER.enabled call the provider (key from chrome.storage, never hardcoded), mapResponse
to { score, signals }, setCached, respond; return true to keep the channel open. Make providers.js
genuinely pluggable with a documented example provider (Pangram-style) disabled by default; when
disabled/unkeyed, degrade gracefully to a neutral result so the extension works without a paid key.`,
      { label: 'deepcheck', phase: 'Build', agentType: 'deepcheck-pipeline-engineer' },
    ),
]);

phase('Test');
const test = await agent(
  `${shared}

ROLE: Test & validation engineer. OWN ONLY: test/** (and package.json test globs if truly needed).
Do NOT modify src/**. Replace test/smoke.test.js with real tests:
- detector.js: evaluate it in a vm context with a stubbed globalThis.LCV = {}, then assert LCV.detect
  output - score bounds 0-100, each signal fires on crafted input and is absent otherwise, obvious-AI
  vs obvious-human direction, and wordCount.
- hash.js: import and assert a known SHA-256 vector.
- cache.js: stub globalThis.chrome.storage.local and assert round-trip + miss.
Then run: cd ${REPO} && npm run lint && npm run format:check && npm test. Fix failures within test/**.
Return the final combined output.`,
  { label: 'tests', phase: 'Test', agentType: 'test-validation-engineer' },
);

return { build, test };
