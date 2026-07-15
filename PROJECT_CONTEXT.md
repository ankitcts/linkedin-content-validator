# Authenticity Notes for LinkedIn — Project Context

> Session context file. Commit this at repo root so any collaborator (or AI assistant)
> can pick up the project with full context.

**Status:** MVP skeleton written · Last updated: 2026-07-14

---

## 1. Problem Statement

LinkedIn is flooded with AI-generated posts presented as authentic personal insight
(404 Media / Pangram data: ~41% of longform LinkedIn content is likely fully
AI-generated). Readers have no fast, in-feed way to challenge an author's implicit
claim of authenticity.

**Goal:** A Chrome extension that embeds a Community Notes-style context card
directly below each LinkedIn post, showing an AI-generation verdict with visible
evidence — instantly, as the user scrolls.

## 2. Key Product Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Form factor | Chrome extension (Manifest V3) on linkedin.com | Meets users where the content is |
| UI pattern | Community Notes-style card embedded below post body | Borrowed credibility; reads as "context," not accusation; scrolls natively with the post |
| NOT a floating overlay | Rejected | Fights LinkedIn scroll containers; feels like adware |
| Responsiveness | Two-stage pipeline (see §4) | Existing tools (incl. Pangram) feel slow — every post waits on a server round-trip |
| Tone | Evidence, not verdict | "94% confidence + highlighted signals" is more persuasive and legally safer than "FAKE" |
| Verdict labels | Likely human-written / Possibly AI-assisted / Likely AI-generated | Probabilistic framing; detectors can be wrong |

## 3. Feasibility & Competitive Findings (researched 2026-07)

- **Technical feasibility: HIGH.** Multiple solo devs have shipped similar extensions.
- **Detection feasibility: MEDIUM.** Best-in-class is Pangram (independently validated
  by UChicago/UMaryland for lowest false-positive rate; API $0.05/1,000 words).
  Free competitors use local heuristics with much weaker accuracy.
- **Market: crowded but barbell-shaped.** One strong player (Pangram) + several free
  hobbyist extensions (LinkedIn AI Post Detector, LinkedLens, Gnesio, etc.).
  Differentiators available to us: **responsiveness** (instant in-feed cards) and
  **evidence-first UX** (sentence-level "why" signals).
- **Legal/policy: MEDIUM, manageable.** DOM-reading extensions are a tolerated gray
  zone (all competitors operate this way). Reputational risk mitigated by
  probabilistic framing and the always-visible disclaimer in the card.
- **Future white space (not in MVP):** author-level reputation scoring
  ("this account's last 50 posts are 90% AI") — cacheable, defensible, B2B-monetizable
  (recruiters, sales). Also: pre-publish self-check for creators.

## 4. Architecture

**Two-stage detection pipeline (the core differentiator):**

1. **Stage 1 — Instant local verdict (<10ms).** `IntersectionObserver` fires when a
   post enters viewport (+200px margin). Local stylometric heuristics run in the
   content script and embed the card immediately. No network, no blank state.
2. **Stage 2 — Async deep check (1–2s).** Post text is sent to the service worker,
   which SHA-256-hashes it, checks `chrome.storage.local` cache, then calls a
   pluggable detection API. The embedded card upgrades in place
   (preliminary → verified). Viral posts hit cache → instant.

**Components:**

```
manifest.json    MV3 config; content scripts on linkedin.com
detector.js      Stage-1 local heuristic scorer (pluggable). Signals:
                 AI-phrase lexicon, em-dash density, sentence-length
                 uniformity (CV < 0.42), "it's not X, it's Y" pattern,
                 rule-of-three lists, emoji-bullet structure.
                 Returns { score: 0-100, signals: [{label, detail}] }.
                 Skips posts < 40 words (unreliable).
content.js       MutationObserver (feed changes) + IntersectionObserver
                 (viewport triggers). Extracts post text, injects card in
                 Shadow DOM (LinkedIn CSS can't break it), requests deep
                 check, updates card.
background.js    Service worker. PROVIDER config (enabled/url/headers),
                 SHA-256 content-hash caching, response mapping to
                 { score, signals }.
```

**Fragile points (by design, isolated):**
- `SELECTORS` object in `content/selectors.js` — fix in one place. As of 2026-07
  LinkedIn's feed uses HASHED, per-build CSS class names (e.g. `_205b22a0`), so
  the old semantic classes (`.feed-shared-update-v2`, `.update-components-text`)
  are gone. We now key off the stable `data-testid` hooks: post body text =
  `[data-testid="expandable-text-box"]` (also the per-post unit we observe), and
  anchor the card after its block-level `<p>` ancestor. If detection stops
  finding posts, re-inspect a post and update these here.

_Note: the `chrome-extension://invalid/ net::ERR_FAILED` spam in LinkedIn's
console is LinkedIn's OWN bundle (`static.licdn.com/aero-v1/…` → `window.fetch`),
not this extension — an extension-detection probe. Harmless; not ours to fix._

## 5. Card UI Spec (Community Notes style)

- Bordered card (#d6d9dc, 8px radius), white bg, LinkedIn system font stack
- Header: shield icon + "AI analysis added context to this post"
- Verdict chip (color-coded: green/amber/red) + confidence bar
- `<details>` expandable: "Why? N signal(s) detected" → evidence list
- Footer disclaimer (always visible): "This is a probabilistic signal, not
  proof. Detectors can be wrong."
- Inserted after post description wrapper, before reaction bar

## 6. Roadmap

- [x] MVP skeleton (4 files above)
- [x] Automated integration harness (jsdom) exercising the content pipeline +
      selectors against representative post markup (`test/integration-content.test.js`)
- [x] Validate selectors against the live feed — done 2026-07: LinkedIn moved to
      hashed class names; selectors reworked to the stable `data-testid` hooks and
      pinned by a real-markup integration test. (Loading unpacked in a logged-in
      browser for a final visual check is still worthwhile.)
- [x] Wire Stage-2 to a real detection model — done 2026-07: default provider is
      a free Hugging Face AI-text detector (`Hello-SimpleAI/chatgpt-detector-roberta`
      via the hf-inference router), keyed by a HF token set in the options page
      (stored in `chrome.storage.local`, never hardcoded). Response mapping is
      unit-tested; with no token the pipeline degrades to the local Stage-1
      heuristic. Pangram remains available in the provider registry as a paid
      alternative. (Live call not exercisable from the build sandbox — the proxy
      blocks huggingface.co — so verify in-browser with a real token.)
- [x] Sentence-level highlighting of flagged passages inside the post
      (CSS Custom Highlight API — paints Ranges without mutating LinkedIn's DOM;
      detector emits exact-cased `spans`, content script highlights them)
- [x] Options page: sensitivity threshold, provider key, on-demand vs auto mode
- [x] Stage-3: on-demand credibility / claim analysis (distinct from AI-detection).
      A "Check facts" button on the card runs: free web evidence (Wikipedia
      search, `search.js`) → pluggable LLM (`llm.js`, default a free HF instruct
      model via the OpenAI-compatible router, swappable to Claude/OpenAI) →
      structured credibility read with flagged claims (`credibility.js`). Framed
      as an assistive signal, never a hard "fake" verdict. Free LLM/search are
      limited (weak on recent/niche claims); the pipeline is built to upgrade.
- [ ] Icons + Chrome Web Store listing assets
- [ ] v2 candidates: author-level reputation aggregation; X/Substack support;
      real web-search grounding; better/paid LLM + detection provider

## 7. Constraints & Principles

- Never render an accusatory verdict; always probability + evidence + disclaimer
- Never hardcode API keys in the extension; keys live in options/storage
- Min 40 words before scoring; short posts get no card
- Cache by content hash; never re-bill the same text
- Privacy: local-first; only Stage-2 sends text off-device (disclose in listing)
