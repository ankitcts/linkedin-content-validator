// Community Notes-style context card, rendered into a Shadow DOM so LinkedIn's
// CSS can't break it. See PROJECT_CONTEXT.md §5 for the full UI spec:
//   - shield icon + "AI analysis added context to this post"
//   - color-coded verdict chip + confidence bar
//   - <details> "Why? N signal(s) detected" -> evidence list
//   - always-visible disclaimer: probabilistic signal, not proof
globalThis.LCV = globalThis.LCV || {};

// Wrapped in an IIFE: content-script files share one lexical scope, so keeping
// these helpers local avoids polluting/colliding with the other scripts. Only
// LCV.renderCard is exported.
(function cardModule() {
  const LCV = globalThis.LCV;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Small DOM helper: create an element with an optional class and text.
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Maps a 0-100 score to a verdict using the shared thresholds/labels so the
  // mapping stays in one place (contract: LCV.THRESHOLDS + LCV.VERDICTS).
  function verdictFor(score) {
    const thresholds = LCV.THRESHOLDS || { ASSISTED: 45, AI: 70 };
    const verdicts = LCV.VERDICTS || {
      HUMAN: 'Likely human-written',
      ASSISTED: 'Possibly AI-assisted',
      AI: 'Likely AI-generated',
    };
    if (score >= thresholds.AI) return { key: 'ai', label: verdicts.AI };
    if (score >= thresholds.ASSISTED) return { key: 'assisted', label: verdicts.ASSISTED };
    return { key: 'human', label: verdicts.HUMAN };
  }

  function shieldIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'lcv-shield');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute(
      'd',
      'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-1 14-3.5-3.5 1.4-1.4L11 13.2l4.1-4.1 1.4 1.4L11 16Z',
    );
    svg.appendChild(path);
    return svg;
  }

  // (Re)builds the card body inside `card` for a given result. Called for the
  // preliminary Stage-1 card and again to upgrade it in place to verified.
  function paint(card, result, { preliminary }) {
    const score = clamp(Math.round(Number(result && result.score) || 0), 0, 100);
    const signals = Array.isArray(result && result.signals) ? result.signals : [];
    const verdict = verdictFor(score);

    // Preserve the "Why?" expanded state across a preliminary -> verified upgrade.
    const existing = card.querySelector('.lcv-why');
    const wasOpen = existing ? existing.open : false;

    card.className = 'lcv-card';
    card.dataset.verdict = verdict.key;
    card.dataset.state = preliminary ? 'preliminary' : 'verified';
    card.replaceChildren();

    const header = el('div', 'lcv-header');
    header.append(
      shieldIcon(),
      el('span', 'lcv-header__text', 'AI analysis added context to this post'),
    );
    card.append(header);

    const verdictRow = el('div', 'lcv-verdict');
    verdictRow.append(
      el('span', 'lcv-chip', verdict.label),
      el('span', 'lcv-state', preliminary ? 'Preliminary' : 'Verified'),
    );
    card.append(verdictRow);

    const confidence = el('div', 'lcv-confidence');
    const bar = el('div', 'lcv-bar');
    const fill = el('div', 'lcv-bar__fill');
    fill.style.width = `${score}%`;
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(score));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.append(fill);
    confidence.append(bar, el('span', 'lcv-score', `${score}% AI-likelihood`));
    card.append(confidence);

    const details = el('details', 'lcv-why');
    details.open = wasOpen;
    const summary = el('summary', 'lcv-why__summary');
    summary.textContent = `Why? ${signals.length} signal${signals.length === 1 ? '' : 's'} detected`;
    details.append(summary);
    if (signals.length) {
      const list = el('ul', 'lcv-signals');
      signals.forEach((signal) => {
        const item = el('li', 'lcv-signal');
        item.append(el('span', 'lcv-signal__label', String((signal && signal.label) || '')));
        if (signal && signal.detail) {
          item.append(el('span', 'lcv-signal__detail', String(signal.detail)));
        }
        list.append(item);
      });
      details.append(list);
    } else {
      details.append(el('p', 'lcv-signals--empty', 'No specific signals to show.'));
    }
    card.append(details);

    card.append(
      el(
        'p',
        'lcv-disclaimer',
        'This is a probabilistic signal, not proof. Detectors can be wrong.',
      ),
    );
  }

  // Builds the card host for a result. Stage-1 renders a preliminary card
  // immediately; call host.lcvUpdate(result) later to upgrade it in place
  // (preliminary -> verified) when the Stage-2 deep check returns.
  LCV.renderCard = function renderCard(result, options) {
    const preliminary = !!(options && options.preliminary);

    const host = document.createElement('div');
    host.className = 'lcv-host';
    host.setAttribute('data-lcv-card', '');

    const shadow = host.attachShadow({ mode: 'open' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content/card.css');
    shadow.append(link);

    const card = document.createElement('div');
    shadow.append(card);

    paint(card, result || { score: 0, signals: [] }, { preliminary });

    host.lcvUpdate = function lcvUpdate(nextResult, nextOptions) {
      paint(card, nextResult || { score: 0, signals: [] }, {
        preliminary: !!(nextOptions && nextOptions.preliminary),
      });
    };

    return host;
  };
})();
