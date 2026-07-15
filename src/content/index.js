// Content-script entry point. Loaded last, after constants/selectors/detector/
// card have populated the shared `LCV` namespace. See PROJECT_CONTEXT.md §4.
//
// Responsibilities:
//   - MutationObserver on the feed to catch newly-rendered posts
//   - IntersectionObserver (+200px margin) to trigger scoring as posts enter view
//   - find post text via LCV.SELECTORS.postText (stable data-testid hook), run
//     LCV.detect() for the Stage-1 card
//   - inject the card via LCV.renderCard() as a block sibling under the post text
//   - request a Stage-2 deep check from the service worker and upgrade the card
globalThis.LCV = globalThis.LCV || {};

(function initContentScript() {
  const LCV = globalThis.LCV;

  // Guard against double-injection (e.g. SPA navigations re-running the script).
  if (LCV.__initialized) return;
  LCV.__initialized = true;

  // One-line heartbeat so it's obvious in the console whether the content script
  // loaded (distinct from LinkedIn's own noise; grep the console for "[LCV]").
  console.info('[LCV] Authenticity Notes: content script active');

  const SELECTORS = LCV.SELECTORS;
  const MIN_WORDS = LCV.MIN_WORDS || 40;

  // User settings mirrored from chrome.storage.sync (written by popup/options).
  // sensitivity 45 == the "possibly AI-assisted" threshold: the detector is
  // deliberately conservative (most AI-styled posts score ~45-55), so a higher
  // default would gate nearly every post and surface no cards.
  const DEFAULTS = { enabled: true, scanMode: 'auto', sensitivity: 45 };
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

  // Gates, scores, injects the Stage-1 card, and kicks off Stage-2 for one post.
  // `textEl` is the post's body text element (SELECTORS.postText).
  function processPost(textEl) {
    if (!textEl || handled.has(textEl)) return;
    handled.add(textEl);

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

    // Anchor the card after the text's block-level ancestor (LinkedIn wraps the
    // body in a <p>), so it lands as a block sibling under the post text.
    const anchor = textEl.closest(SELECTORS.anchorBlock) || textEl;
    if (!anchor || !anchor.isConnected) return;

    const host = LCV.renderCard(result, { state: 'preliminary' });
    anchor.insertAdjacentElement('afterend', host);
    console.debug('[LCV] card injected — score', result.score);

    // Paint the flagged passages inside the post itself (best-effort).
    try {
      highlightSpans(textEl, result.spans);
    } catch {
      // Highlighting must never break the card or the feed.
    }

    requestDeepCheck(text, host, result);
  }

  // Stage-2: ask the service worker for a deep check and settle the card.
  //   - real provider result  -> repaint as 'verified' with the provider verdict
  //   - no provider / failure  -> keep the Stage-1 heuristic, settle as 'local'
  // Crucially we do NOT overwrite the informative Stage-1 verdict with the
  // service worker's neutral placeholder when no provider is configured.
  function requestDeepCheck(text, host, localResult) {
    const settleLocal = () => {
      if (typeof host.lcvUpdate === 'function') host.lcvUpdate(localResult, { state: 'local' });
    };
    try {
      chrome.runtime.sendMessage({ type: 'deep-check', text }, (response) => {
        if (chrome.runtime.lastError || !response || response.unavailable) {
          settleLocal();
          return;
        }
        if (typeof host.lcvUpdate === 'function') {
          host.lcvUpdate(response, { state: 'verified' });
        }
      });
    } catch {
      // Extension context invalidated; keep the preliminary card.
    }
  }

  // --- In-post passage highlighting ---------------------------------------
  // Paints the detector's flagged passages using the CSS Custom Highlight API,
  // which styles text ranges WITHOUT mutating the DOM — so LinkedIn's own
  // markup/React is untouched and a feed re-render can't leave orphaned wrapper
  // nodes behind. No-ops silently where the API is unavailable.
  const HIGHLIGHT_NAME = 'lcv-ai-flag';
  let highlight = null;

  function highlightSupported() {
    return (
      typeof CSS !== 'undefined' &&
      !!CSS.highlights &&
      typeof Highlight !== 'undefined' &&
      typeof document.createRange === 'function' &&
      typeof document.createTreeWalker === 'function'
    );
  }

  // Lazily create the shared Highlight registry entry and inject the page-level
  // style for its ::highlight() pseudo (once).
  function ensureHighlight() {
    if (highlight) return highlight;
    highlight = new Highlight();
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    const style = document.createElement('style');
    style.id = 'lcv-highlight-style';
    style.textContent =
      `::highlight(${HIGHLIGHT_NAME}){background-color:rgba(230,168,0,0.28);` +
      `text-decoration:underline dotted rgba(180,120,0,0.9);}`;
    (document.head || document.documentElement).append(style);
    return highlight;
  }

  // Adds a Range over every occurrence of each flagged passage within `root`.
  function highlightSpans(root, spans) {
    if (!root || !Array.isArray(spans) || !spans.length || !highlightSupported()) return;
    const needles = spans
      .map((span) => span && span.text)
      .filter((text) => typeof text === 'string' && text.length >= 3);
    if (!needles.length) return;

    const hl = ensureHighlight();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const hay = node.nodeValue;
      if (!hay) continue;
      for (const needle of needles) {
        let idx = hay.indexOf(needle);
        while (idx !== -1) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + needle.length);
          hl.add(range);
          idx = hay.indexOf(needle, idx + needle.length);
        }
      }
    }
  }

  // Registers any not-yet-observed post text elements with the
  // IntersectionObserver (each is one textual feed post).
  function registerPosts(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll(SELECTORS.postText).forEach((textEl) => {
      if (observed.has(textEl)) return;
      observed.add(textEl);
      io.observe(textEl);
    });
  }

  // On-demand mode / popup "Scan now": score every currently-rendered post
  // regardless of viewport or scan mode.
  function scanNow() {
    document.querySelectorAll(SELECTORS.postText).forEach((textEl) => processPost(textEl));
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
