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

  // Card styles, inlined into the Shadow DOM via a <style> element. Inlining (vs
  // a <link> to chrome.runtime.getURL('content/card.css')) removes the runtime
  // dependency entirely: no web_accessible_resources needed, and no
  // "chrome-extension://invalid/" failures if the extension context is flaky.
  const CARD_CSS = `
:host {
  all: initial;
  display: block;
}
.lcv-card {
  box-sizing: border-box;
  margin: 8px 0;
  padding: 12px 14px;
  border: 1px solid #d6d9dc;
  border-radius: 8px;
  background: #ffffff;
  font-family: -apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: #1d2226;
}
.lcv-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #56687a;
  font-size: 13px;
  font-weight: 600;
}
.lcv-shield {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  color: #56687a;
}
.lcv-header__text {
  min-width: 0;
}
.lcv-verdict {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.lcv-chip {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
}
.lcv-card[data-verdict='human'] .lcv-chip {
  background: #e9f7ef;
  color: #1a7f47;
  border-color: #b7e4c7;
}
.lcv-card[data-verdict='assisted'] .lcv-chip {
  background: #fdf4e3;
  color: #9a6a00;
  border-color: #f3d9a4;
}
.lcv-card[data-verdict='ai'] .lcv-chip {
  background: #fdecec;
  color: #b42318;
  border-color: #f4c2be;
}
.lcv-state {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #8a97a4;
}
.lcv-card[data-state='verified'] .lcv-state {
  color: #1a7f47;
}
.lcv-confidence {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.lcv-bar {
  position: relative;
  flex: 1 1 auto;
  height: 6px;
  border-radius: 999px;
  background: #eef1f3;
  overflow: hidden;
}
.lcv-bar__fill {
  height: 100%;
  border-radius: inherit;
  transition: width 0.2s ease;
}
.lcv-card[data-verdict='human'] .lcv-bar__fill {
  background: #1a7f47;
}
.lcv-card[data-verdict='assisted'] .lcv-bar__fill {
  background: #d68f00;
}
.lcv-card[data-verdict='ai'] .lcv-bar__fill {
  background: #d92d20;
}
.lcv-score {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  color: #56687a;
  font-variant-numeric: tabular-nums;
}
.lcv-card[data-state='preliminary'] .lcv-bar__fill {
  opacity: 0.7;
}
.lcv-why {
  margin-top: 10px;
}
.lcv-why__summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: #0a66c2;
  list-style: none;
}
.lcv-why__summary::-webkit-details-marker {
  display: none;
}
.lcv-why__summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 6px;
  font-size: 11px;
  transition: transform 0.15s ease;
}
.lcv-why[open] .lcv-why__summary::before {
  transform: rotate(90deg);
}
.lcv-signals {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lcv-signal {
  padding: 6px 8px;
  border-radius: 6px;
  background: #f4f6f8;
  font-size: 13px;
}
.lcv-signal__label {
  font-weight: 600;
}
.lcv-signal__detail {
  display: block;
  margin-top: 2px;
  color: #56687a;
}
.lcv-signals--empty {
  margin: 8px 0 0;
  font-size: 13px;
  color: #56687a;
}
.lcv-disclaimer {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 1px solid #eef1f3;
  font-size: 12px;
  color: #8a97a4;
}
`;

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

  // Human label for each card state:
  //   preliminary — instant Stage-1 result, Stage-2 deep check still pending
  //   verified    — confirmed by a Stage-2 detection provider
  //   local       — settled on the Stage-1 heuristic (no Stage-2 provider set)
  function stateLabel(state) {
    if (state === 'verified') return 'Verified';
    if (state === 'local') return 'Local';
    return 'Preliminary';
  }

  // (Re)builds the card body inside `card` for a given result and state.
  function paint(card, result, state) {
    const score = clamp(Math.round(Number(result && result.score) || 0), 0, 100);
    const signals = Array.isArray(result && result.signals) ? result.signals : [];
    const verdict = verdictFor(score);

    // Preserve the "Why?" expanded state across a re-paint.
    const existing = card.querySelector('.lcv-why');
    const wasOpen = existing ? existing.open : false;

    card.className = 'lcv-card';
    card.dataset.verdict = verdict.key;
    card.dataset.state = state;
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
      el('span', 'lcv-state', stateLabel(state)),
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

  // Builds the card host for a result. Stage-1 renders a 'preliminary' card
  // immediately; call host.lcvUpdate(result, { state }) later to repaint it in
  // place — 'verified' once a Stage-2 provider confirms, or 'local' when there
  // is no provider and the Stage-1 heuristic is the final word.
  LCV.renderCard = function renderCard(result, options) {
    const state = (options && options.state) || 'preliminary';

    const host = document.createElement('div');
    host.className = 'lcv-host';
    host.setAttribute('data-lcv-card', '');

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CARD_CSS;
    shadow.append(style);

    const card = document.createElement('div');
    shadow.append(card);

    paint(card, result || { score: 0, signals: [] }, state);

    host.lcvUpdate = function lcvUpdate(nextResult, nextOptions) {
      paint(
        card,
        nextResult || { score: 0, signals: [] },
        (nextOptions && nextOptions.state) || 'verified',
      );
    };

    return host;
  };
})();
