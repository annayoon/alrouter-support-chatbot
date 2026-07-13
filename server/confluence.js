import { embedTexts } from './ollama.js';
import { getFaqChunks } from './faq.js';

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
// The built-in FAQ (faq.js) is always included; Confluence pages are merged in
// when configured.
export async function getKnowledgeBaseChunks() {
  const isFresh = Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (isFresh && cache.chunks.length) return cache.chunks;

  try {
    const confluenceChunks = isConfluenceConfigured() ? await fetchSpacePages() : [];
    const chunks = [...getFaqChunks(), ...confluenceChunks];
    await attachEmbeddings(chunks);
    cache = { chunks, fetchedAt: Date.now() };
    return chunks;
  } catch (err) {
    console.error('[confluence] failed to fetch knowledge base:', err.message);
    // Stale cache beats FAQ-only; FAQ-only (keyword retrieval) beats nothing.
    return cache.chunks.length ? cache.chunks : getFaqChunks();
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

// Customers write the brand name inconsistently (AlRouter / alrouter / 알라우터).
// Normalize to one canonical spelling before retrieval so keyword matching and
// embeddings both see the same string the KB itself uses ("AlRouter").
const BRAND_ALIASES = [
  { pattern: /알\s*라우터/gi, canonical: 'AlRouter' },
  { pattern: /al\s*router/gi, canonical: 'AlRouter' },
];

function normalizeBrandMentions(text) {
  return BRAND_ALIASES.reduce((acc, { pattern, canonical }) => acc.replace(pattern, canonical), text);
}

// Semantic retrieval via embeddings; falls back to keyword overlap when
// embeddings are unavailable (embed model not pulled, Ollama down at KB fetch).
export async function selectRelevantChunks(chunks, query, topK = 4) {
  if (!chunks.length) return [];

  query = normalizeBrandMentions(query);

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

// Bare verb-ending/copula tokens that leak into answer prose ("이용하실 수 있어")
// and collide with substrings all over the KB — "있어" once tied the correct
// chunk and lost on array order. Dropped so they can't score. Deliberately does
// NOT include interrogatives (어떻게/어디/무슨…): those match the stored FAQ
// *question* text and are a useful disambiguating signal, not noise.
const KEYWORD_STOPWORDS = new Set([
  '있어', '있나요', '있는', '있을', '있습니다', '없어', '없나요', '없는',
  '해요', '하나요', '하는', '합니다', '되나요', '되는', '됩니다', '돼요',
  '인가요', '인가', '까요', '나요',
]);

// Trailing particles/endings stripped so an inflected query token matches the
// KB's plain stem ("시스템하고" → "시스템", "연동할" → "연동", "그룹웨어랑" → "그룹웨어").
// Longer particles first; only stripped when ≥2 chars remain so short stems survive.
const PARTICLE_SUFFIXES = [
  '이랑', '에서', '으로', '에게', '까지', '부터', '보다', '처럼', '이나', '하고', '마다',
  '은', '는', '이', '가', '을', '를', '에', '의', '도', '만', '과', '와', '랑', '로',
  '할', '한', '해', '된', '될', '돼',
];

function stripParticle(token) {
  for (const suffix of PARTICLE_SUFFIXES) {
    if (token.length > suffix.length + 1 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

// Keyword-overlap fallback: score each chunk by how many query tokens it contains.
function selectByKeyword(chunks, query, topK) {
  const tokens = query
    // Korean particles attach directly to Latin words with no space ("AlRouter가"),
    // which would otherwise survive as one unmatchable token — split the boundary.
    .replace(/([a-zA-Z0-9])([가-힣])/g, '$1 $2')
    .replace(/([가-힣])([a-zA-Z0-9])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s,.?!:;()[\]"'~]+/)
    .map(stripParticle)
    .filter((t) => t.length >= 2 && !KEYWORD_STOPWORDS.has(t));

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
