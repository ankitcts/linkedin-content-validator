// Service-worker entry point (MV3 background, ESM module). Handles Stage-2 deep
// checks requested by the content script: SHA-256-hash the text, check the
// cache, call the provider on a miss, cache and return { score, signals }.
// See PROJECT_CONTEXT.md §4.
//
// The pipeline pieces are ready to wire up:
//   import { sha256 } from './hash.js';
//   import { getCached, setCached } from './cache.js';
//   import { PROVIDER, mapResponse } from './providers.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // TODO: dispatch on message.type === 'deep-check', run the hash -> cache ->
  // provider pipeline, then sendResponse({ score, signals }). Return true to
  // keep the message channel open for the async response.
  sendResponse({ score: 0, signals: [] });
  return true;
});
