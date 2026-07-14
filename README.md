# Authenticity Notes for LinkedIn

A Chrome extension (Manifest V3) that embeds a Community Notes-style context card
directly below each LinkedIn post, showing a probabilistic AI-generation verdict
with visible, sentence-level evidence — instantly, as the user scrolls.

## Why

LinkedIn is increasingly flooded with AI-generated posts presented as authentic
personal insight. Readers have no fast, in-feed way to gauge an author's implicit
claim of authenticity. This extension adds that context — **as evidence, not an
accusation**: a confidence score plus the specific signals behind it, always paired
with a disclaimer that detectors can be wrong.

## How it works

A two-stage detection pipeline keeps the card instant while still allowing a deeper check:

1. **Stage 1 — instant local verdict (<10ms).** Local stylometric heuristics run in
   the content script the moment a post enters the viewport, and embed the card with
   no network round-trip.
2. **Stage 2 — async deep check (1–2s).** The post text is content-hashed, cached, and
   sent to a pluggable detection API. The embedded card upgrades in place
   (preliminary → verified).

Flagged passages are also highlighted inline within the post via the CSS Custom
Highlight API, which paints text ranges **without modifying LinkedIn's DOM** (so their
markup and React state are left untouched); it degrades to a no-op where unsupported.

See [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) for the full problem statement,
product decisions, architecture, UI spec, roadmap, and guiding principles.

## Development

Requires Node.js 20+ (see `.nvmrc`).

```bash
npm install        # install dev tooling (ESLint, Prettier)
npm run lint       # lint with ESLint (flat config, browser + webextension globals)
npm run format     # auto-format with Prettier
npm test           # run tests (Node's built-in test runner)
npm run package    # zip src/ into dist/ (manifest.json at archive root)
```

Extension source lives in `src/` (loaded unpacked in Chrome during development).

### Testing

- **Unit tests** cover the Stage-1 detector signals, SHA-256 hashing, and the cache.
- **Integration test** (`test/integration-content.test.js`) loads the content scripts in
  manifest order into a `jsdom` LinkedIn-shaped fixture and drives the real
  `IntersectionObserver → detect → renderCard → inject` flow, asserting the card is
  injected (and upgraded via a mocked Stage-2), and that the `MIN_WORDS` and sensitivity
  gates work. This validates our own wiring and selectors against representative markup;
  it does **not** replace a manual check against the live, authenticated LinkedIn feed
  (which requires loading the unpacked extension in a logged-in Chrome).

### Project structure

```
src/
  manifest.json           MV3 config; wires content scripts, service worker, UI
  content/                Content scripts (classic, share the global `LCV` namespace)
    constants.js          Verdict labels, thresholds, MIN_WORDS
    selectors.js          LinkedIn DOM selectors (isolated fragile point)
    detector.js           Stage-1 local heuristic scorer -> { score, signals }
    card.js               Community Notes-style card (Shadow DOM)
    card.css              Card styles (injected into the shadow root)
    index.js              Entry: Mutation/Intersection observers, inject, Stage-2 request
  service-worker/         MV3 background (ESM module)
    index.js              Entry: Stage-2 deep-check message handler
    providers.js          Pluggable detection-API config + response mapping
    cache.js              Content-hash cache over chrome.storage.local
    hash.js               SHA-256 helper (Web Crypto)
  popup/                  Toolbar popup UI
  options/                Settings page (sensitivity, provider key, scan mode)
  assets/icons/           Extension icons (see README there)

scripts/package.mjs       Zips src/ into a distributable extension archive
test/                     Tests (Node built-in runner)
```

See `PROJECT_CONTEXT.md` §4 for how these components interact.

### CI/CD

- **CI** (`.github/workflows/ci.yml`) runs lint, format check, and tests on every
  push to `main` and every pull request.
- **Release** (`.github/workflows/release.yml`) packages the extension into a
  versioned `.zip` and publishes a GitHub Release when a `v*` tag is pushed
  (e.g. `git tag v0.1.0 && git push origin v0.1.0`).

## Status

MVP skeleton stage. This repository is being scaffolded — see the roadmap in
`PROJECT_CONTEXT.md`.
