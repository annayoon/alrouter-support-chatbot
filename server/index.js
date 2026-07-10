import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { getKnowledgeBaseChunks, selectRelevantChunks, formatChunks, isConfluenceConfigured } from './confluence.js';
import { buildSystemPrompt, getChatReply, summarizeConversation } from './ollama.js';
import { AlertReason, sendAlert, isAlertingConfigured } from './alerts.js';
import { detectHumanRequest, detectNegativeSentiment, detectNoAnswer } from './detect.js';
import { matchTopicRule } from './topicRules.js';
import { containsBannedWord, maskSensitiveInfo } from './moderation.js';

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const NO_MATCH_REPLY = '문의하신 내용은 정확한 답변을 위해 담당자에게 전달했습니다. 확인 후 안내드리겠습니다.';
const BANNED_WORD_REPLY = '부적절한 표현이 감지되어 답변을 드릴 수 없습니다. 정중한 표현으로 다시 문의해주세요.';

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static('public'));

// In-memory session store: sessionId -> { history, alerted, lastActiveAt }
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;
// Stored history is capped so an abandoned-but-active session can't grow unbounded;
// the model itself only sees the last few turns (see ollama.js).
const MAX_STORED_HISTORY = 20;

// pagehide (used to signal "tab closed") also fires on an ordinary refresh, so
// a /session/end call doesn't finalize immediately — it's delayed by this grace
// period, canceled if the same session sends another /api/chat in the meantime
// (i.e. it was just a reload), and only then treated as a real end.
const SESSION_END_GRACE_MS = 10 * 1000;
const pendingEndTimers = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: [], alerted: new Set(), lastActiveAt: Date.now() });
  }
  const session = sessions.get(sessionId);
  session.lastActiveAt = Date.now();

  const pendingEnd = pendingEndTimers.get(sessionId);
  if (pendingEnd) {
    clearTimeout(pendingEnd);
    pendingEndTimers.delete(sessionId);
  }

  return session;
}

async function finalizeSessionEnd(sessionId) {
  pendingEndTimers.delete(sessionId);
  const session = sessions.get(sessionId);
  if (!session) return;

  if (session.history.length > 0) {
    try {
      const summary = await summarizeConversation(session.history);
      await sendAlert(AlertReason.SESSION_SUMMARY, { sessionId, summary });
    } catch (err) {
      console.error('[session/end] summary failed:', err.message);
    }
  }
  sessions.delete(sessionId);
}

// Widgets closed without calling /session/end would otherwise leak forever.
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.lastActiveAt < cutoff) sessions.delete(id);
  }
}, 10 * 60 * 1000).unref();

// Per-IP sliding-window rate limit. /api/chat drives an LLM call, so even a
// modest request loop would saturate Ollama without this.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 15;
const rateBuckets = new Map();

setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.windowStart < cutoff) rateBuckets.delete(ip);
  }
}, 5 * 60 * 1000).unref();

function rateLimit(req, res, next) {
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }
  next();
}

const MAX_MESSAGE_LENGTH = 1000;

async function maybeAlert(session, sessionId, reason, payload) {
  if (session.alerted.has(reason)) return; // throttle: once per session per reason
  session.alerted.add(reason);
  await sendAlert(reason, { sessionId, ...payload });
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    confluenceConfigured: isConfluenceConfigured(),
    alertingConfigured: isAlertingConfigured(),
  });
});

app.post('/api/chat', rateLimit, async (req, res) => {
  const { sessionId: incomingSessionId, message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
  }

  const sessionId = incomingSessionId || randomUUID();
  const session = getSession(sessionId);
  // Mask PII (resident registration/card/phone numbers) before it ever touches
  // session history, the model, or outbound alert webhooks.
  const safeMessage = maskSensitiveInfo(message);

  try {
    if (containsBannedWord(message)) {
      const reply = BANNED_WORD_REPLY;
      session.history.push({ role: 'user', content: safeMessage });
      session.history.push({ role: 'assistant', content: reply });
      await maybeAlert(session, sessionId, AlertReason.INAPPROPRIATE_LANGUAGE, { userMessage: safeMessage, botReply: reply });
      return res.json({ sessionId, reply });
    }

    const topicRule = matchTopicRule(safeMessage);

    let reply;
    let noKnowledgeMatch = false;

    if (topicRule) {
      // Fixed, guaranteed answer for sensitive topics (pricing, etc.) — never let the model improvise here.
      reply = topicRule.reply;
    } else {
      const allChunks = await getKnowledgeBaseChunks();
      const relevantChunks = await selectRelevantChunks(allChunks, safeMessage);

      // KB is set up but nothing matches this question — don't let the model guess, answer deterministically.
      noKnowledgeMatch = isConfluenceConfigured() && relevantChunks.length === 0;

      reply = noKnowledgeMatch
        ? NO_MATCH_REPLY
        : await getChatReply({
            systemPrompt: buildSystemPrompt(formatChunks(relevantChunks)),
            history: session.history,
            userMessage: safeMessage,
          });
    }

    session.history.push({ role: 'user', content: safeMessage });
    session.history.push({ role: 'assistant', content: reply });
    if (session.history.length > MAX_STORED_HISTORY) {
      session.history.splice(0, session.history.length - MAX_STORED_HISTORY);
    }

    if (topicRule) {
      await maybeAlert(session, sessionId, AlertReason.TOPIC_RULE_MATCHED, { userMessage: safeMessage, botReply: reply });
    }
    if (detectHumanRequest(safeMessage)) {
      await maybeAlert(session, sessionId, AlertReason.HUMAN_REQUESTED, { userMessage: safeMessage, botReply: reply });
    }
    if (detectNegativeSentiment(safeMessage)) {
      await maybeAlert(session, sessionId, AlertReason.NEGATIVE_SENTIMENT, { userMessage: safeMessage, botReply: reply });
    }
    if (noKnowledgeMatch || detectNoAnswer(reply)) {
      await maybeAlert(session, sessionId, AlertReason.NO_ANSWER, { userMessage: safeMessage, botReply: reply });
    }

    res.json({ sessionId, reply });
  } catch (err) {
    console.error('[chat] failed:', err.message);
    res.status(502).json({ error: 'Failed to reach the chat model. Is Ollama running?' });
  }
});

app.post('/api/session/end', (req, res) => {
  const { sessionId } = req.body || {};
  const session = sessionId && sessions.get(sessionId);

  if (session && !pendingEndTimers.has(sessionId)) {
    const timer = setTimeout(() => finalizeSessionEnd(sessionId), SESSION_END_GRACE_MS);
    timer.unref();
    pendingEndTimers.set(sessionId, timer);
  }

  res.status(204).end();
});

app.listen(PORT, HOST, () => {
  console.log(`alrouter.ai support chatbot server listening on http://${HOST}:${PORT}`);
  console.log(`Confluence KB configured: ${isConfluenceConfigured()}`);
  console.log(`Alerting configured: ${isAlertingConfigured()}`);
});
