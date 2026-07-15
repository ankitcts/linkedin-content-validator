// Community Notes-style context card, rendered into a Shadow DOM so LinkedIn's
// CSS can't break it (and ours can't leak out). See PROJECT_CONTEXT.md §5.
// Supports a light/dark theme via a `data-theme` attribute + CSS variables, with
// a theme toggle in the card header.
globalThis.LCV = globalThis.LCV || {};

// Wrapped in an IIFE: content-script files share one lexical scope, so keeping
// these helpers local avoids polluting/colliding with the other scripts. Only
// LCV.renderCard is exported.
(function cardModule() {
  const LCV = globalThis.LCV;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Card styles, inlined into the Shadow DOM via a <style> element. Colors are
  // CSS custom properties defined on .lcv-card; the [data-theme='dark'] block
  // swaps the token values, so light/dark is a pure variable switch.
  const CARD_CSS = `
:host { all: initial; display: block; }
* { box-sizing: border-box; }
.lcv-card {
  --bg: #ffffff;
  --fg: #1d2226;
  --muted: #5b6b7b;
  --faint: #8a97a4;
  --border: #e4e7eb;
  --divider: #eceff2;
  --track: #edf0f3;
  --surface: #f5f7f9;
  --accent: #0a66c2;
  --accent-weak: #eaf1f9;
  --human-bg: #e7f6ee; --human-fg: #14713f; --human-bar: #1a9d57;
  --assisted-bg: #fdf3e2; --assisted-fg: #8a5d00; --assisted-bar: #e0930a;
  --ai-bg: #fdecec; --ai-fg: #b42318; --ai-bar: #d92d20;
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.05);

  margin: 10px 0;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  box-shadow: var(--shadow);
  font-family: -apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: var(--fg);
}
.lcv-card[data-theme='dark'] {
  --bg: #1b2027;
  --fg: #e8eaed;
  --muted: #9aa7b2;
  --faint: #7c8895;
  --border: #303840;
  --divider: #29313a;
  --track: #2b333c;
  --surface: #232b33;
  --accent: #6cb0f0;
  --accent-weak: #1d2a39;
  --human-bg: #14301f; --human-fg: #63d495; --human-bar: #34b26c;
  --assisted-bg: #352a12; --assisted-fg: #e7b657; --assisted-bar: #e0930a;
  --ai-bg: #3a1f1e; --ai-fg: #f28e86; --ai-bar: #e5564b;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
.lcv-header { display: flex; align-items: center; gap: 8px; }
.lcv-shield { flex: 0 0 auto; width: 16px; height: 16px; color: var(--accent); }
.lcv-header__text {
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--muted);
}
.lcv-theme {
  margin-left: auto;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.lcv-theme:hover { background: var(--surface); color: var(--fg); }
.lcv-theme svg { width: 15px; height: 15px; }
.lcv-theme__sun { display: none; }
.lcv-card[data-theme='dark'] .lcv-theme__moon { display: none; }
.lcv-card[data-theme='dark'] .lcv-theme__sun { display: block; }
.lcv-verdict { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.lcv-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  background: var(--surface);
  color: var(--fg);
}
.lcv-chip::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.lcv-card[data-verdict='human'] .lcv-chip { background: var(--human-bg); color: var(--human-fg); }
.lcv-card[data-verdict='assisted'] .lcv-chip { background: var(--assisted-bg); color: var(--assisted-fg); }
.lcv-card[data-verdict='ai'] .lcv-chip { background: var(--ai-bg); color: var(--ai-fg); }
.lcv-state {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--faint);
}
.lcv-card[data-state='verified'] .lcv-state { color: var(--human-fg); }
.lcv-confidence { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.lcv-bar {
  position: relative;
  flex: 1 1 auto;
  height: 8px;
  border-radius: 999px;
  background: var(--track);
  overflow: hidden;
}
.lcv-bar__fill { height: 100%; border-radius: inherit; background: var(--muted); transition: width 0.25s ease; }
.lcv-card[data-verdict='human'] .lcv-bar__fill { background: var(--human-bar); }
.lcv-card[data-verdict='assisted'] .lcv-bar__fill { background: var(--assisted-bar); }
.lcv-card[data-verdict='ai'] .lcv-bar__fill { background: var(--ai-bar); }
.lcv-card[data-state='preliminary'] .lcv-bar__fill { opacity: 0.55; }
.lcv-score { flex: 0 0 auto; font-size: 12px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
.lcv-why { margin-top: 12px; }
.lcv-why__summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  list-style: none;
  display: inline-flex;
  align-items: center;
}
.lcv-why__summary::-webkit-details-marker { display: none; }
.lcv-why__summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 6px;
  font-size: 10px;
  transition: transform 0.15s ease;
}
.lcv-why[open] .lcv-why__summary::before { transform: rotate(90deg); }
.lcv-signals { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.lcv-signal { padding: 8px 10px; border-radius: 8px; background: var(--surface); font-size: 13px; }
.lcv-signal__label { font-weight: 600; }
.lcv-signal__detail { display: block; margin-top: 2px; color: var(--muted); }
.lcv-signals--empty { margin: 10px 0 0; font-size: 13px; color: var(--muted); }
.lcv-disclaimer { margin: 12px 0 0; padding-top: 10px; border-top: 1px solid var(--divider); font-size: 12px; color: var(--faint); }
.lcv-fact { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--divider); }
.lcv-fact__btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--accent);
  background: var(--accent-weak);
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 999px;
  cursor: pointer;
}
.lcv-fact__btn:hover { filter: brightness(0.98); }
.lcv-fact__btn:disabled { opacity: 0.6; cursor: default; }
.lcv-fact__body:not(:empty) { margin-top: 12px; }
.lcv-cred__msg { margin: 0; font-size: 13px; color: var(--muted); }
.lcv-cred__head { display: flex; align-items: center; gap: 8px; }
.lcv-cred__chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  background: var(--surface);
  color: var(--fg);
}
.lcv-fact__body[data-verdict='authentic'] .lcv-cred__chip { background: var(--human-bg); color: var(--human-fg); }
.lcv-fact__body[data-verdict='mixed'] .lcv-cred__chip { background: var(--assisted-bg); color: var(--assisted-fg); }
.lcv-fact__body[data-verdict='dicey'] .lcv-cred__chip { background: var(--ai-bg); color: var(--ai-fg); }
.lcv-cred__conf { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.lcv-cred__summary { margin: 10px 0 0; font-size: 13px; color: var(--fg); }
.lcv-cred__claims { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.lcv-cred__claim { padding: 8px 10px; border-radius: 8px; background: var(--surface); font-size: 13px; }
.lcv-cred__status {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--track);
  color: var(--muted);
}
.lcv-cred__claim[data-status='supported'] .lcv-cred__status { background: var(--human-bg); color: var(--human-fg); }
.lcv-cred__claim[data-status='disputed'] .lcv-cred__status { background: var(--ai-bg); color: var(--ai-fg); }
.lcv-cred__note { display: block; margin-top: 2px; color: var(--muted); }
.lcv-cred__disclaimer { margin: 10px 0 0; font-size: 12px; color: var(--faint); }
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

  // SVG helper (built via createElementNS, never innerHTML, to respect any
  // Trusted-Types policy on the page).
  function svgNode(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
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
    const svg = svgNode('svg', {
      class: 'lcv-shield',
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    svg.append(
      svgNode('path', {
        fill: 'currentColor',
        d: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-1 14-3.5-3.5 1.4-1.4L11 13.2l4.1-4.1 1.4 1.4L11 16Z',
      }),
    );
    return svg;
  }

  function sunIcon() {
    const svg = svgNode('svg', {
      class: 'lcv-theme__sun',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'aria-hidden': 'true',
    });
    svg.append(svgNode('circle', { cx: '12', cy: '12', r: '4' }));
    svg.append(
      svgNode('path', {
        d: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19',
      }),
    );
    return svg;
  }

  function moonIcon() {
    const svg = svgNode('svg', {
      class: 'lcv-theme__moon',
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      'aria-hidden': 'true',
    });
    svg.append(svgNode('path', { d: 'M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z' }));
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

  // (Re)builds the AI-analysis content inside `body`; `container` carries the
  // verdict/state/theme data attributes (for styling). The fact-check section
  // lives outside `body`, so it survives these repaints. paint() sets className
  // and verdict/state only — it does not touch data-theme.
  function paint(container, body, result, state) {
    const score = clamp(Math.round(Number(result && result.score) || 0), 0, 100);
    const signals = Array.isArray(result && result.signals) ? result.signals : [];
    const verdict = verdictFor(score);

    // Preserve the "Why?" expanded state across a re-paint.
    const existing = body.querySelector('.lcv-why');
    const wasOpen = existing ? existing.open : false;

    container.className = 'lcv-card';
    container.dataset.verdict = verdict.key;
    container.dataset.state = state;
    body.replaceChildren();

    const header = el('div', 'lcv-header');
    const themeBtn = el('button', 'lcv-theme');
    themeBtn.type = 'button';
    themeBtn.title = 'Toggle light / dark';
    themeBtn.setAttribute('aria-label', 'Toggle light or dark theme');
    themeBtn.append(sunIcon(), moonIcon());
    themeBtn.addEventListener('click', () => {
      themeBtn.dispatchEvent(
        new CustomEvent('lcv-theme-toggle', { bubbles: true, composed: true }),
      );
    });
    header.append(
      shieldIcon(),
      el('span', 'lcv-header__text', 'AI analysis added context to this post'),
      themeBtn,
    );
    body.append(header);

    const verdictRow = el('div', 'lcv-verdict');
    verdictRow.append(
      el('span', 'lcv-chip', verdict.label),
      el('span', 'lcv-state', stateLabel(state)),
    );
    body.append(verdictRow);

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
    body.append(confidence);

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
    body.append(details);

    body.append(
      el(
        'p',
        'lcv-disclaimer',
        'This is a probabilistic signal, not proof. Detectors can be wrong.',
      ),
    );
  }

  // Verdict metadata for the credibility (fact) analysis.
  const CRED = {
    authentic: { key: 'authentic', label: 'Looks credible' },
    mixed: { key: 'mixed', label: 'Mixed / check further' },
    dicey: { key: 'dicey', label: 'Dicey — verify' },
  };
  const STATUS_LABEL = { supported: 'Supported', unverified: 'Unverified', disputed: 'Disputed' };

  // Renders the credibility result into `factBody` for a given phase:
  //   'loading' | 'error' (data.reason) | 'done' (data = analysis result).
  function renderCredibility(factBody, phase, data) {
    factBody.replaceChildren();
    factBody.dataset.verdict = '';

    if (phase === 'loading') {
      factBody.append(el('p', 'lcv-cred__msg', 'Checking facts… (this can take a few seconds)'));
      return;
    }
    if (phase !== 'done' || !data) {
      const reason = (data && data.reason) || '';
      const msg =
        reason === 'no-token'
          ? 'Add a Hugging Face token in Options to enable fact-checking.'
          : reason === 'parse'
            ? 'The model returned an unreadable result. Try again.'
            : 'Couldn’t complete the credibility check.';
      factBody.append(el('p', 'lcv-cred__msg', msg));
      return;
    }

    const cred = CRED[data.verdict] || CRED.mixed;
    factBody.dataset.verdict = cred.key;

    const head = el('div', 'lcv-cred__head');
    head.append(el('span', 'lcv-cred__chip', cred.label));
    if (Number.isFinite(Number(data.confidence))) {
      head.append(
        el('span', 'lcv-cred__conf', `${Math.round(Number(data.confidence))}% confidence`),
      );
    }
    factBody.append(head);

    if (data.summary) factBody.append(el('p', 'lcv-cred__summary', String(data.summary)));

    const claims = Array.isArray(data.claims) ? data.claims : [];
    if (claims.length) {
      const list = el('ul', 'lcv-cred__claims');
      claims.forEach((c) => {
        const item = el('li', 'lcv-cred__claim');
        item.dataset.status = c.status;
        item.append(el('span', 'lcv-cred__status', STATUS_LABEL[c.status] || 'Unverified'));
        item.append(el('span', 'lcv-cred__text', String(c.claim || '')));
        if (c.note) item.append(el('span', 'lcv-cred__note', String(c.note)));
        list.append(item);
      });
      factBody.append(list);
    }

    factBody.append(
      el(
        'p',
        'lcv-cred__disclaimer',
        'AI-assisted credibility signal, not a fact-check verdict. Verify important claims yourself.',
      ),
    );
  }

  // Builds the card host for a result. Stage-1 renders a 'preliminary' card
  // immediately; call host.lcvUpdate(result, { state }) later to repaint it in
  // place. host.lcvSetTheme('light'|'dark') switches the theme in place.
  LCV.renderCard = function renderCard(result, options) {
    const state = (options && options.state) || 'preliminary';
    const theme = options && options.theme === 'dark' ? 'dark' : 'light';

    const host = document.createElement('div');
    host.className = 'lcv-host';
    host.setAttribute('data-lcv-card', '');

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CARD_CSS;
    shadow.append(style);

    // container (.lcv-card, carries verdict/state/theme) > body (repainted) + fact.
    const container = document.createElement('div');
    container.dataset.theme = theme;
    const body = el('div', 'lcv-body');
    container.append(body);
    shadow.append(container);

    paint(container, body, result || { score: 0, signals: [] }, state);

    // On-demand credibility ("Check facts") section — persists across repaints.
    const factSection = el('div', 'lcv-fact');
    const factBtn = el('button', 'lcv-fact__btn', 'Check facts (beta)');
    factBtn.type = 'button';
    const factBody = el('div', 'lcv-fact__body');
    factBtn.addEventListener('click', () => {
      host.dispatchEvent(new CustomEvent('lcv-factcheck'));
    });
    factSection.append(factBtn, factBody);
    container.append(factSection);

    host.lcvUpdate = function lcvUpdate(nextResult, nextOptions) {
      paint(
        container,
        body,
        nextResult || { score: 0, signals: [] },
        (nextOptions && nextOptions.state) || 'verified',
      );
    };

    host.lcvSetTheme = function lcvSetTheme(nextTheme) {
      container.dataset.theme = nextTheme === 'dark' ? 'dark' : 'light';
    };

    // phase: 'loading' | 'error' | 'done'
    host.lcvRenderCredibility = function lcvRenderCredibility(phase, data) {
      factBtn.disabled = phase === 'loading';
      renderCredibility(factBody, phase, data);
    };

    return host;
  };
})();
