// Shared constants for the content scripts (verdict labels, thresholds).
// Loaded first in the content-script list so it initialises the shared `LCV`
// namespace that the other content scripts attach to. See PROJECT_CONTEXT.md §4–5.
globalThis.LCV = globalThis.LCV || {};

// Probabilistic verdict labels (never accusatory — see §7).
globalThis.LCV.VERDICTS = {
  HUMAN: 'Likely human-written',
  ASSISTED: 'Possibly AI-assisted',
  AI: 'Likely AI-generated',
};

// Posts shorter than this are not scored (heuristics unreliable — §7).
globalThis.LCV.MIN_WORDS = 40;

// Score thresholds (0–100) that map a Stage-1 score to a verdict.
globalThis.LCV.THRESHOLDS = {
  ASSISTED: 45,
  AI: 70,
};
