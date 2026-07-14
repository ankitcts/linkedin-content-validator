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
- `SELECTORS` object at top of content.js — LinkedIn DOM classes change
  periodically; fix in one place. Current: post = `div.feed-shared-update-v2,
  div[data-id^="urn:li:activity"]`; text = `.update-components-text, ...`.

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
- [ ] Load unpacked, validate selectors against live LinkedIn feed (manual, logged-in browser)
- [ ] Wire Stage-2 to a real detection API (candidate: Pangram, $0.05/1k words;
      map response in background.js) — on-demand or viewport-only scanning to
      control cost. Pluggable provider registry + disabled Pangram-style example
      already in place; needs a live key + verified request/response mapping.
- [ ] Sentence-level highlighting of flagged passages inside the post
- [x] Options page: sensitivity threshold, provider key, on-demand vs auto mode
- [ ] Icons + Chrome Web Store listing assets
- [ ] v2 candidates: author-level reputation aggregation; X/Substack support

## 7. Constraints & Principles

- Never render an accusatory verdict; always probability + evidence + disclaimer
- Never hardcode API keys in the extension; keys live in options/storage
- Min 40 words before scoring; short posts get no card
- Cache by content hash; never re-bill the same text
- Privacy: local-first; only Stage-2 sends text off-device (disclose in listing)
