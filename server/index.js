import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { getKnowledgeBaseChunks, selectRelevantChunks, formatChunks, isConfluenceConfigured } from './confluence.js';
import { buildSystemPrompt, getChatReply, summarizeConversation, rewriteQuery } from './ollama.js';
import { AlertReason, sendAlert, isAlertingConfigured } from './alerts.js';
import { detectHumanRequest, detectNegativeSentiment, detectNoAnswer } from './detect.js';
import { matchTopicRule, resolveTopicReply } from './topicRules.js';
import { containsBannedWord, maskSensitiveInfo } from './moderation.js';
import { matchGuideLink } from './guideLinks.js';

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const NO_MATCH_REPLY = '문의하신 내용은 정확한 답변을 위해 담당자에게 전달했습니다. 확인 후 안내드리겠습니다. 답변받으실 이메일 주소를 남겨주시면 이메일로 안내드리겠습니다.';
// One round of narrowing before giving up: a vague follow-up often just needs
// clarification before retrieval can find the right document.
const CLARIFY_REPLY = '정확한 안내를 위해 조금 더 알려주시겠어요? 어떤 기능이나 화면에서 겪고 계신 문제인지 말씀해주시면 바로 확인해드리겠습니다.';
const CONTACT_THANKS_REPLY = '감사합니다. 담당자가 확인 후 남겨주신 이메일로 안내드리겠습니다.';
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
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
    sessions.set(sessionId, {
      history: [],
      alerted: new Set(),
      lastActiveAt: Date.now(),
      askedClarification: false,
      awaitingContact: false,
      contact: null,
    });
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

    // After an escalation the bot asked for an email address — capture it,
    // notify staff with full context, and skip the LLM entirely.
    if (session.awaitingContact) {
      const email = safeMessage.match(EMAIL_RE)?.[0];
      if (email) {
        session.awaitingContact = false;
        session.contact = email;
        const reply = CONTACT_THANKS_REPLY;
        session.history.push({ role: 'user', content: safeMessage });
        session.history.push({ role: 'assistant', content: reply });
        await sendAlert(AlertReason.CONTACT_PROVIDED, {
          sessionId,
          contact: email,
          recentHistory: session.history.slice(-8),
        });
        return res.json({ sessionId, reply });
      }
      // Not an email — the customer moved on; handle the message normally.
    }

    const topicRule = matchTopicRule(safeMessage);

    let reply;
    let noKnowledgeMatch = false;
    let clarifying = false;

    if (topicRule) {
      // Fixed, guaranteed answer for sensitive topics (pricing, etc.) — never let the model improvise here.
      reply = resolveTopicReply(topicRule, safeMessage);
    } else {
      const allChunks = await getKnowledgeBaseChunks();
      // Follow-ups like "어떻게 해야 하나요?" carry no searchable keywords on
      // their own — rewrite them into standalone questions using the history.
      const searchQuery = await rewriteQuery(session.history, safeMessage);
      const relevantChunks = await selectRelevantChunks(allChunks, searchQuery);

      // KB is set up but nothing matches this question — don't let the model guess, answer deterministically.
      noKnowledgeMatch = isConfluenceConfigured() && relevantChunks.length === 0;

      if (noKnowledgeMatch && !session.askedClarification) {
        session.askedClarification = true;
        clarifying = true;
        reply = CLARIFY_REPLY;
      } else if (noKnowledgeMatch) {
        session.awaitingContact = true;
        reply = NO_MATCH_REPLY;
      } else {
        reply = await getChatReply({
          systemPrompt: buildSystemPrompt(formatChunks(relevantChunks)),
          history: session.history,
          userMessage: safeMessage,
        });
        // The model can also decide it has no answer (its system prompt tells
        // it to say so) — treat that like a KB miss: clarify once first, then
        // escalate with an email request.
        if (detectNoAnswer(reply)) {
          if (!session.askedClarification) {
            session.askedClarification = true;
            clarifying = true;
            reply = CLARIFY_REPLY;
          } else if (!session.awaitingContact && !session.contact) {
            session.awaitingContact = true;
            reply += ' 답변받으실 이메일 주소를 남겨주시면 이메일로 안내드리겠습니다.';
          }
        } else {
          // Real answer given — point to the public guide page when the topic
          // has one, so the customer can follow the full walkthrough.
          const guide = matchGuideLink(`${safeMessage} ${searchQuery}`);
          if (guide) {
            reply += `\n\n📖 ${guide.label}\n${guide.url}`;
          }
        }
      }
    }

    session.history.push({ role: 'user', content: safeMessage });
    session.history.push({ role: 'assistant', content: reply });
    if (session.history.length > MAX_STORED_HISTORY) {
      session.history.splice(0, session.history.length - MAX_STORED_HISTORY);
    }

    if (topicRule && !topicRule.silent) {
      await maybeAlert(session, sessionId, AlertReason.TOPIC_RULE_MATCHED, { userMessage: safeMessage, botReply: reply });
    }
    const alertContext = { contact: session.contact, recentHistory: session.history.slice(-8) };
    if (detectHumanRequest(safeMessage)) {
      await maybeAlert(session, sessionId, AlertReason.HUMAN_REQUESTED, { userMessage: safeMessage, botReply: reply, ...alertContext });
    }
    if (detectNegativeSentiment(safeMessage)) {
      await maybeAlert(session, sessionId, AlertReason.NEGATIVE_SENTIMENT, { userMessage: safeMessage, botReply: reply, ...alertContext });
    }
    // While clarifying, no alert yet — staff only hears about it if the
    // clarified question still has no answer.
    if ((noKnowledgeMatch && !clarifying) || (!clarifying && detectNoAnswer(reply))) {
      await maybeAlert(session, sessionId, AlertReason.NO_ANSWER, { userMessage: safeMessage, botReply: reply, ...alertContext });
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
