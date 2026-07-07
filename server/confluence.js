import { embedTexts } from './ollama.js';

const {
  CONFLUENCE_BASE_URL,
  CONFLUENCE_ROOT_PAGE_ID,
  CONFLUENCE_EXCLUDE_PAGE_IDS,
  CONFLUENCE_EMAIL,
  CONFLUENCE_API_TOKEN,
} = process.env;

const excludedPageIds = new Set(
  (CONFLUENCE_EXCLUDE_PAGE_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)
);

export function isConfluenceConfigured() {
  return Boolean(CONFLUENCE_BASE_URL && CONFLUENCE_ROOT_PAGE_ID && CONFLUENCE_EMAIL && CONFLUENCE_API_TOKEN);
}

const MAX_CHUNK_LEN = 400;

const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ',
};

function decodeEntities(text) {
  return text.replace(/&(#?\w+);/g, (match, code) => HTML_ENTITIES[code] ?? match);
}

function stripHtml(html) {
  return decodeEntities(
    html
      // turn block-level boundaries into newlines before stripping tags, so we can chunk by them
      .replace(/<\/(p|li|h[1-6]|br|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    // never let raw links (internal docs, restricted sheets, etc.) reach the model or the customer
    .replace(/https?:\/\/\S+/g, '[링크 생략]')
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
  const wikiBase = `${CONFLUENCE_BASE_URL.replace(/\/$/, '')}/wiki`;
  const cql = `ancestor=${CONFLUENCE_ROOT_PAGE_ID}`;
  let url = `${wikiBase}/rest/api/content/search` +
    `?cql=${encodeURIComponent(cql)}&expand=body.storage&limit=100`;

  const chunks = [];

  while (url) {
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
    for (const page of data.results || []) {
      if (excludedPageIds.has(String(page.id))) continue;
      chunks.push(...chunkText(page.title, stripHtml(page.body?.storage?.value || '')));
    }

    url = data._links?.next ? `${wikiBase}${data._links.next}` : null;
  }

  return chunks;
}

// Returns cached knowledge base chunks: [{ title, text }, ...]
export async function getKnowledgeBaseChunks() {
  if (!isConfluenceConfigured()) return [];

  const isFresh = Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (isFresh && cache.chunks.length) return cache.chunks;

  try {
    const chunks = await fetchSpacePages();
    await attachEmbeddings(chunks);
    cache = { chunks, fetchedAt: Date.now() };
    return chunks;
  } catch (err) {
    console.error('[confluence] failed to fetch knowledge base:', err.message);
    return cache.chunks;
  }
}

// Embeds all chunks in one batch at KB refresh time (every CACHE_TTL, not per
// request). If the embed model is unavailable the chunks stay embedding-less
// and retrieval falls back to keyword matching.
async function attachEmbeddings(chunks) {
  if (!chunks.length) return;
  const embeddings = await embedTexts(chunks.map((c) => `${c.title}\n${c.text}`));
  if (!embeddings) return;
  chunks.forEach((chunk, i) => { chunk.embedding = embeddings[i]; });
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// Below this similarity a chunk is considered unrelated to the question, so the
// server answers deterministically instead of letting the model improvise.
const MIN_SIMILARITY = 0.4;

// Semantic retrieval via embeddings; falls back to keyword overlap when
// embeddings are unavailable (embed model not pulled, Ollama down at KB fetch).
export async function selectRelevantChunks(chunks, query, topK = 4) {
  if (!chunks.length) return [];

  if (chunks[0].embedding) {
    const queryEmbeddings = await embedTexts([query]);
    if (queryEmbeddings) {
      const scored = chunks
        .filter((c) => c.embedding)
        .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbeddings[0], chunk.embedding) }))
        .filter((s) => s.score >= MIN_SIMILARITY)
        .sort((a, b) => b.score - a.score);
      return scored.slice(0, topK).map((s) => s.chunk);
    }
  }

  return selectByKeyword(chunks, query, topK);
}

// Keyword-overlap fallback: score each chunk by how many query tokens it contains.
function selectByKeyword(chunks, query, topK) {
  const tokens = query
    .toLowerCase()
    .split(/[\s,.?!:;()[\]"'~]+/)
    .filter((t) => t.length >= 2);

  if (!tokens.length) return chunks.slice(0, topK);

  const scored = chunks.map((chunk) => {
    const haystack = (chunk.title + ' ' + chunk.text).toLowerCase();
    const score = tokens.reduce((sum, t) => sum + (haystack.includes(t) ? 1 : 0), 0);
    return { chunk, score };
  });

  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  return matched.slice(0, topK).map((s) => s.chunk);
}

export function formatChunks(chunks) {
  return chunks.map((c) => `### ${c.title}\n${c.text}`).join('\n\n');
}
