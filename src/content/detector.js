// Stage-1 local heuristic scorer (pluggable). Runs in the content script for an
// instant (<10ms), network-free verdict. See PROJECT_CONTEXT.md §4.
//
// Contract: detect(text) -> { score: 0-100, signals: [{ label, detail }] }
// Skips posts shorter than LCV.MIN_WORDS (caller enforces).
globalThis.LCV = globalThis.LCV || {};

globalThis.LCV.detect = function detect() {
  // TODO(text): compute stylometric signals —
  //   - AI-phrase lexicon hits
  //   - em-dash density
  //   - sentence-length uniformity (coefficient of variation < 0.42)
  //   - "it's not X, it's Y" pattern
  //   - rule-of-three lists
  //   - emoji-bullet structure
  // Aggregate into a 0–100 score with the contributing signals.
  return { score: 0, signals: [] };
};
