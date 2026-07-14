// Community Notes-style context card, rendered into a Shadow DOM so LinkedIn's
// CSS can't break it. See PROJECT_CONTEXT.md §5 for the full UI spec:
//   - shield icon + "AI analysis added context to this post"
//   - color-coded verdict chip + confidence bar
//   - <details> "Why? N signal(s) detected" -> evidence list
//   - always-visible disclaimer: probabilistic signal, not proof
globalThis.LCV = globalThis.LCV || {};

// Builds the card element for a given result. Stage-1 renders a preliminary
// card immediately; Stage-2 upgrades it in place (preliminary -> verified).
globalThis.LCV.renderCard = function renderCard() {
  // TODO(result, { preliminary }): construct the shadow-root card from the
  // verdict/score/signals and return the host element to inject.
};
