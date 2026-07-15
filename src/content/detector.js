// Stage-1 local heuristic scorer (pluggable). Runs in the content script for an
// instant (<10ms), network-free verdict. See PROJECT_CONTEXT.md §4.
//
// Contract: detect(text) -> { score: 0-100, signals: [{ label, detail }] }
// Skips posts shorter than LCV.MIN_WORDS (caller enforces the gate).
//
// Pure and deterministic: no DOM, no network, no globals beyond attaching to
// LCV. Kept as a classic script (attaches to globalThis.LCV; no export) so it
// stays testable against a stubbed global.
globalThis.LCV = globalThis.LCV || {};

// Stock LLM / "LinkedIn-voice" phrasing. Lowercased; matched as substrings.
// A single hit is weak evidence; several together are a strong tell.
const AI_PHRASES = [
  "in today's fast-paced world",
  'in the ever-evolving',
  "it's important to note",
  "it's important to remember",
  'at the end of the day',
  "let's dive in",
  "let's unpack",
  'dive deep',
  'game-changer',
  'game changer',
  'delve into',
  'delve',
  'a testament to',
  'navigate the complexities',
  'in the realm of',
  'when it comes to',
  'the key takeaway',
  'key takeaways',
  'take your',
  'to the next level',
  'unlock the power',
  'unlock your',
  'harness the power',
  'the power of',
  'cutting-edge',
  'ever-changing',
  'seamless',
  'seamlessly',
  'robust',
  'leverage',
  'foster',
  'elevate',
  'empower',
  'supercharge',
  'revolutionize',
  'embark on a journey',
  'a journey of',
  'pivotal',
  'underscore',
  'resonate with',
  'a myriad of',
  'a plethora of',
  'holistic',
  'paradigm shift',
  'synergy',
  'move the needle',
  'here are the',
  'here is why',
  "here's why",
  "here's the thing",
  'let that sink in',
  'the result?',
  'the takeaway?',
  'the takeaway',
  'read that again',
  // Corporate / thought-leader "LinkedIn voice" tells (higher-precision, mostly
  // multi-word to keep false positives low on casual human writing).
  'is noteworthy',
  'should be viewed as',
  'emerging as',
  'the reality is',
  'make no mistake',
  'the bottom line',
  'more than just',
  "this isn't just",
  'now more than ever',
  'in a world where',
  'in an era where',
  'is no longer optional',
  'transforming the way',
  'changing the game',
  'the rise of',
  'buckle up',
  'plot twist',
  'let me explain',
  'what this means',
  'mark my words',
  // Engagement-bait / CTA phrasing common in AI-assisted marketing posts.
  'tell us in the comments',
  'let us know in the comments',
  'drop a comment',
  'comment below',
  'share your thoughts',
  'what do you think?',
  'tag someone who',
  'double tap',
];

// Emoji / symbol characters commonly used to open a bullet line.
const BULLET_LEAD = /^\s*(?:\p{Extended_Pictographic}|[•▪▸●➡⮕✔✅])/u;

// Contrastive "it's not X, it's Y" cliché (and close variants).
const NOT_X_BUT_Y = [
  /it['’]?s\s+not\b[^.!?\n]{1,60}?\bit['’]?s\b/gi,
  /it\s+is\s?n['’]?t\b[^.!?\n]{1,60}?\bit['’]?s\b/gi,
  /\bnot\s+(?:just\s+)?about\b[^.!?\n]{1,50}?\b(?:it['’]?s|but)\s+about\b/gi,
];

// "a, b, and c" (or "…or c") triadic list — the rule-of-three tell.
const RULE_OF_THREE =
  /\b[\w'’-]+(?:\s+[\w'’-]+){0,3},\s+[\w'’-]+(?:\s+[\w'’-]+){0,3},\s+(?:and|or)\s+[\w'’-]+/gi;

// Count words (whitespace-delimited, non-empty tokens). Exposed for callers
// that gate on LCV.MIN_WORDS before scoring.
globalThis.LCV.wordCount = function wordCount(text) {
  if (typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
};

// Split into sentences on terminal punctuation; drop empties.
function splitSentences(text) {
  return text
    .split(/[.!?]+(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Round to `places` decimals, returning a Number (deterministic detail strings).
function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

globalThis.LCV.detect = function detect(text) {
  const signals = [];
  if (typeof text !== 'string' || !text.trim()) {
    return { score: 0, signals, spans: [] };
  }

  const words = globalThis.LCV.wordCount(text);
  const lower = text.toLowerCase();
  let score = 0;

  // 1. AI-phrase lexicon --------------------------------------------------
  const matched = [];
  for (const phrase of AI_PHRASES) {
    if (lower.includes(phrase)) matched.push(phrase);
  }
  // Drop a shorter phrase when a longer matched phrase already contains it
  // (e.g. "delve" inside "delve into") so it isn't double-counted.
  const hits = matched.filter((p) => !matched.some((other) => other !== p && other.includes(p)));
  if (hits.length) {
    score += Math.min(30, hits.length * 7);
    const shown = hits.slice(0, 3).map((p) => `"${p}"`);
    const extra = hits.length > 3 ? ` (+${hits.length - 3} more)` : '';
    signals.push({
      label: 'AI-phrase lexicon',
      detail: `${hits.length} stock phrase${hits.length === 1 ? '' : 's'}: ${shown.join(', ')}${extra}`,
    });
  }

  // 2. Em-dash density ----------------------------------------------------
  const emDashes = (text.match(/[—–]/g) || []).length;
  if (emDashes >= 2 && words > 0) {
    const density = (emDashes / words) * 100;
    score += Math.min(18, Math.round(density * 6));
    signals.push({
      label: 'Em-dash density',
      detail: `${emDashes} em-dashes (${round(density, 1)} per 100 words)`,
    });
  }

  // 3. Sentence-length uniformity (coefficient of variation < 0.42) --------
  const sentences = splitSentences(text);
  if (sentences.length >= 4) {
    const lengths = sentences.map((s) => globalThis.LCV.wordCount(s));
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    if (mean > 0) {
      const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
      const cv = Math.sqrt(variance) / mean;
      if (cv < 0.42) {
        score += Math.round((20 * (0.42 - cv)) / 0.42);
        signals.push({
          label: 'Uniform sentence length',
          detail: `${sentences.length} sentences, low length variation (CV ${round(cv, 2)})`,
        });
      }
    }
  }

  // 4. "It's not X, it's Y" contrastive construction ----------------------
  let notXButY = 0;
  for (const re of NOT_X_BUT_Y) {
    notXButY += (text.match(re) || []).length;
  }
  if (notXButY > 0) {
    score += Math.min(28, notXButY * 16);
    signals.push({
      label: '"It\'s not X, it\'s Y" construction',
      detail: `${notXButY} instance${notXButY === 1 ? '' : 's'} of the contrastive cliché`,
    });
  }

  // 5. Rule-of-three lists ------------------------------------------------
  const triads = (text.match(RULE_OF_THREE) || []).length;
  if (triads > 0) {
    score += Math.min(16, triads * 7);
    signals.push({
      label: 'Rule-of-three phrasing',
      detail: `${triads} triadic list${triads === 1 ? '' : 's'} (e.g. "a, b, and c")`,
    });
  }

  // 6. Emoji-bullet structure ---------------------------------------------
  const bullets = text.split(/\n/).filter((line) => BULLET_LEAD.test(line)).length;
  if (bullets >= 3) {
    score += Math.min(20, bullets * 5);
    signals.push({
      label: 'Emoji-bullet structure',
      detail: `${bullets} emoji-led bullet lines`,
    });
  }

  // 7. Emoji sprinkling ---------------------------------------------------
  // Decorative emoji scattered through prose is a common AI / social-marketing
  // tell (distinct from the bullet-list structure above).
  const emoji = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emoji >= 3) {
    score += Math.min(14, emoji * 3);
    signals.push({
      label: 'Heavy emoji use',
      detail: `${emoji} emoji sprinkled through the text`,
    });
  }

  // 8. Hashtag stuffing ---------------------------------------------------
  const hashtags = (text.match(/(?:^|\s)#[\p{L}0-9_]+/gu) || []).length;
  if (hashtags >= 3) {
    score += Math.min(12, hashtags * 4);
    signals.push({
      label: 'Hashtag cluster',
      detail: `${hashtags} hashtags`,
    });
  }

  // 9. "Broetry" one-line-paragraph structure -----------------------------
  // The signature LinkedIn AI/influencer layout: many one-sentence paragraphs
  // separated by blank lines. Needs the raw text with line breaks preserved.
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const shortParas = paragraphs.filter((p) => globalThis.LCV.wordCount(p) <= 20).length;
  if (paragraphs.length >= 5 && shortParas >= 4) {
    score += Math.min(24, shortParas * 4);
    signals.push({
      label: 'One-line-paragraph style',
      detail: `${shortParas} short single-line paragraphs (LinkedIn "broetry")`,
    });
  }

  // Flagged passages: the exact-cased substrings that fired a phrase/clause
  // signal, for optional in-post highlighting by the content script. Structural
  // signals (em-dash density, sentence uniformity, emoji bullets) have no single
  // passage to point at, so they contribute no spans.
  const spans = [];
  const seenSpans = new Set();
  function addSpan(snippet, reason) {
    const trimmed = (snippet || '').trim();
    if (trimmed.length < 3) return;
    const key = `${trimmed}`;
    if (seenSpans.has(key)) return;
    seenSpans.add(key);
    spans.push({ text: trimmed, reason });
  }

  for (const phrase of hits) {
    let from = lower.indexOf(phrase);
    while (from !== -1) {
      addSpan(text.slice(from, from + phrase.length), 'Stock phrase');
      from = lower.indexOf(phrase, from + phrase.length);
    }
  }
  for (const re of NOT_X_BUT_Y) {
    for (const match of text.matchAll(re)) addSpan(match[0], 'Contrastive “not X, it’s Y”');
  }
  for (const match of text.matchAll(RULE_OF_THREE)) addSpan(match[0], 'Rule-of-three list');

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    signals,
    spans: spans.slice(0, 12),
  };
};
