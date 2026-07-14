// LinkedIn DOM selectors — the one deliberately-isolated fragile point.
// LinkedIn's CSS classes change periodically; when the extension stops finding
// posts, fix the selectors here and nowhere else. See PROJECT_CONTEXT.md §4.
globalThis.LCV = globalThis.LCV || {};

globalThis.LCV.SELECTORS = {
  // A single feed post container.
  post: 'div.feed-shared-update-v2, div[data-id^="urn:li:activity"]',
  // The post body text within a post container.
  postText: '.update-components-text, .feed-shared-update-v2__description',
  // Where the context card is inserted (after the description, before reactions).
  cardAnchor: '.feed-shared-update-v2__description-wrapper',
};
