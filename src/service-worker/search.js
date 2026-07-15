// Free, keyless grounding via the Wikipedia search API — the realistic free
// "web search" for v1 (real search APIs need paid keys). Returns short snippets
// used as evidence for the credibility LLM. Pluggable: swap in a proper web
// search provider later without touching the pipeline.
const WIKI_ENDPOINT = 'https://en.wikipedia.org/w/api.php';

/** Turn post text into a compact search query (drop urls/hashtags/punctuation). */
export function buildSearchQuery(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@][\p{L}\p{N}_]+/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * @param {string} text
 * @param {number} [limit]
 * @returns {Promise<Array<{ title: string, snippet: string }>>}
 */
export async function searchEvidence(text, limit = 3) {
  const query = buildSearchQuery(text);
  if (!query) return [];
  const url =
    `${WIKI_ENDPOINT}?action=query&list=search&format=json&origin=*` +
    `&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const hits = data && data.query && Array.isArray(data.query.search) ? data.query.search : [];
    return hits.slice(0, limit).map((h) => ({
      title: String(h.title || ''),
      // Wikipedia snippets contain <span> highlight markup — strip it.
      snippet: String(h.snippet || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .trim(),
    }));
  } catch {
    return [];
  }
}
