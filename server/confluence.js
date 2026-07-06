const {
  CONFLUENCE_BASE_URL,
  CONFLUENCE_SPACE_KEY,
  CONFLUENCE_EMAIL,
  CONFLUENCE_API_TOKEN,
} = process.env;

export function isConfluenceConfigured() {
  return Boolean(CONFLUENCE_BASE_URL && CONFLUENCE_SPACE_KEY && CONFLUENCE_EMAIL && CONFLUENCE_API_TOKEN);
}

const MAX_CHUNK_LEN = 400;

function stripHtml(html) {
  return html
    // turn block-level boundaries into newlines before stripping tags, so we can chunk by them
    .replace(/<\/(p|li|h[1-6]|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function chunkText(title, text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';

  for (const line of lines) {
    if ((buf + ' ' + line).trim().length > MAX_CHUNK_LEN) {
      if (buf) chunks.push(buf.trim());
      buf = line;
    } else {
      buf = (buf + ' ' + line).trim();
    }
  }
  if (buf) chunks.push(buf.trim());

  return chunks.map((text) => ({ title, text }));
}

let cache = { chunks: [], fetchedAt: 0 };
const CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchSpacePages() {
  const auth = Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_API_TOKEN}`).toString('base64');
  const url = `${CONFLUENCE_BASE_URL.replace(/\/$/, '')}/wiki/rest/api/content` +
    `?spaceKey=${encodeURIComponent(CONFLUENCE_SPACE_KEY)}&expand=body.storage&limit=50`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Confluence API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return (data.results || []).flatMap((page) =>
    chunkText(page.title, stripHtml(page.body?.storage?.value || ''))
  );
}

// Returns cached knowledge base chunks: [{ title, text }, ...]
export async function getKnowledgeBaseChunks() {
  if (!isConfluenceConfigured()) return [];

  const isFresh = Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (isFresh && cache.chunks.length) return cache.chunks;

  try {
    const chunks = await fetchSpacePages();
    cache = { chunks, fetchedAt: Date.now() };
    return chunks;
  } catch (err) {
    console.error('[confluence] failed to fetch knowledge base:', err.message);
    return cache.chunks;
  }
}

// Simple keyword-overlap retrieval: score each chunk by how many query tokens it contains.
export function selectRelevantChunks(chunks, query, topK = 4) {
  const tokens = query
    .toLowerCase()
    .split(/[\s,.?!:;()[\]"'~]+/)
    .filter((t) => t.length >= 2);

  if (!chunks.length || !tokens.length) return chunks.slice(0, topK);

  const scored = chunks.map((chunk) => {
    const haystack = chunk.text.toLowerCase();
    const score = tokens.reduce((sum, t) => sum + (haystack.includes(t) ? 1 : 0), 0);
    return { chunk, score };
  });

  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (!matched.length) return [];

  return matched.slice(0, topK).map((s) => s.chunk);
}

export function formatChunks(chunks) {
  return chunks.map((c) => `### ${c.title}\n${c.text}`).join('\n\n');
}
