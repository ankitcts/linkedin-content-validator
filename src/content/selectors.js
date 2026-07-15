// LinkedIn DOM hooks — the one deliberately-isolated fragile point.
//
// LinkedIn's feed now renders with HASHED, per-build CSS class names
// (e.g. "_205b22a0 a214530a e5658197 …"), so the old semantic class selectors
// (.feed-shared-update-v2, .update-components-text, …) no longer exist. We key
// off the stable hooks LinkedIn keeps instead — `data-testid` attributes.
//
// If detection stops finding posts, re-inspect a feed post and update these in
// this one place. See PROJECT_CONTEXT.md §4.
globalThis.LCV = globalThis.LCV || {};

globalThis.LCV.SELECTORS = {
  // The post body text — one per textual feed post. This element is both the
  // unit we observe (viewport) and the text we score.
  postText: '[data-testid="expandable-text-box"]',
  // The "…more" truncation toggle (kept for reference / future full-text expand).
  moreButton: '[data-testid="expandable-text-button"]',
  // Tag name of the block-level ancestor to anchor the card after, so the card
  // is inserted as a block sibling rather than inside inline/flex text flow.
  // Falls back to the text element itself when not found.
  anchorBlock: 'p',
};
