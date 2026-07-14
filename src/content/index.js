// Content-script entry point. Loaded last, after constants/selectors/detector/
// card have populated the shared `LCV` namespace. See PROJECT_CONTEXT.md §4.
//
// Responsibilities:
//   - MutationObserver on the feed to catch newly-rendered posts
//   - IntersectionObserver (+200px margin) to trigger scoring as posts enter view
//   - extract post text via LCV.SELECTORS, run LCV.detect() for the Stage-1 card
//   - inject the card via LCV.renderCard() before the reaction bar
//   - request a Stage-2 deep check from the service worker and upgrade the card
globalThis.LCV = globalThis.LCV || {};

(function initContentScript() {
  const LCV = globalThis.LCV;

  // Guard against double-injection (e.g. SPA navigations re-running the script).
  if (LCV.__initialized) return;
  LCV.__initialized = true;

  const SELECTORS = LCV.SELECTORS;
  const MIN_WORDS = LCV.MIN_WORDS || 40;

  // User settings mirrored from chrome.storage.sync (written by popup/options).
  const DEFAULTS = { enabled: true, scanMode: 'auto', sensitivity: 70 };
  const settings = { ...DEFAULTS };

  // Posts we've registered with the IntersectionObserver, and posts we've
  // already fully handled (scored + possibly carded). WeakSets so detached DOM
  // nodes are garbage-collected without leaking.
  const observed = new WeakSet();
  const handled = new WeakSet();

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        if (settings.enabled && settings.scanMode === 'auto') {
          processPost(entry.target);
        }
      }
    },
    { rootMargin: '200px' },
  );

  function normalize(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function wordCount(text) {
    return text ? text.split(' ').length : 0;
  }

  // Extracts, gates, scores, injects the Stage-1 card, and kicks off Stage-2.
  function processPost(post) {
    if (handled.has(post)) return;
    handled.add(post);

    const textEl = post.querySelector(SELECTORS.postText);
    if (!textEl) return;

    const text = normalize(textEl.textContent);
    if (wordCount(text) < MIN_WORDS) return;

    let result;
    try {
      result = LCV.detect(text);
    } catch {
      return;
    }
    if (!result) return;

    // The options "sensitivity threshold" gates which posts surface a card;
    // low-scoring (likely human) posts stay uncluttered and skip the paid
    // Stage-2 round-trip.
    if (Number(result.score) < settings.sensitivity) return;

    const anchor = post.querySelector(SELECTORS.cardAnchor) || textEl;
    if (!anchor || !anchor.isConnected) return;

    const host = LCV.renderCard(result, { preliminary: true });
    anchor.insertAdjacentElement('afterend', host);

    requestDeepCheck(text, host);
  }

  // Stage-2: ask the service worker for a deep check and upgrade the card in
  // place. Failures (worker asleep/invalidated) leave the preliminary card as-is.
  function requestDeepCheck(text, host) {
    try {
      chrome.runtime.sendMessage({ type: 'deep-check', text }, (response) => {
        if (chrome.runtime.lastError || !response) return;
        if (typeof host.lcvUpdate === 'function') {
          host.lcvUpdate(response, { preliminary: false });
        }
      });
    } catch {
      // Extension context invalidated; keep the preliminary card.
    }
  }

  // Registers any not-yet-observed posts with the IntersectionObserver.
  function registerPosts(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll(SELECTORS.post).forEach((post) => {
      if (observed.has(post)) return;
      observed.add(post);
      io.observe(post);
    });
  }

  // On-demand mode / popup "Scan now": score every currently-rendered post
  // regardless of viewport or scan mode.
  function scanNow() {
    document.querySelectorAll(SELECTORS.post).forEach((post) => processPost(post));
  }

  // Debounced MutationObserver: LinkedIn injects posts continuously as the feed
  // renders and paginates. Coalesce bursts into one registration pass per frame.
  let scheduled = false;
  function scheduleRegister() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      registerPosts(document);
    });
  }

  const mo = new MutationObserver(scheduleRegister);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Popup triggers an on-demand scan of the active tab via a runtime message.
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'lcv-scan') scanNow();
  });

  // Keep settings live so toggling enable/mode/sensitivity in the popup or
  // options page takes effect without a page reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) {
      if (key in settings) settings[key] = change.newValue;
    }
  });

  chrome.storage.sync.get(DEFAULTS).then((stored) => {
    Object.assign(settings, stored);
  });

  // Catch posts already in the DOM at load (script runs at document_idle).
  registerPosts(document);
})();
