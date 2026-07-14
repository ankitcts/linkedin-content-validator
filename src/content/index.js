// Content-script entry point. Loaded last, after constants/selectors/detector/
// card have populated the shared `LCV` namespace. See PROJECT_CONTEXT.md §4.
//
// Responsibilities:
//   - MutationObserver on the feed to catch newly-rendered posts
//   - IntersectionObserver (+200px margin) to trigger scoring as posts enter view
//   - extract post text via LCV.SELECTORS, run LCV.detect() for the Stage-1 card
//   - inject the card via LCV.renderCard() before the reaction bar
//   - request a Stage-2 deep check from the service worker and upgrade the card
//
// TODO: implement the observers and message passing (chrome.runtime.sendMessage).
globalThis.LCV = globalThis.LCV || {};
