import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { getKnowledgeBaseChunks, selectRelevantChunks, formatChunks, isConfluenceConfigured } from './confluence.js';
import { buildSystemPrompt, getChatReply, summarizeConversation } from './ollama.js';
import { AlertReason, sendAlert, isAlertingConfigured } from './alerts.js';
import { detectHumanRequest, detectNegativeSentiment, detectNoAnswer } from './detect.js';

const app = express();
const PORT = process.env.PORT || 3000;

const NO_MATCH_REPLY = '문의하신 내용은 정확한 답변을 위해 담당자에게 전달했습니다. 확인 후 안내드리겠습니다.';

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

// In-memory session store: sessionId -> { history: [{role, content}], alerted: Set<reason> }
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: [], alerted: new Set() });
  }
  return sessions.get(sessionId);
}

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

app.post('/api/chat', async (req, res) => {
  const { sessionId: incomingSessionId, message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  const sessionId = incomingSessionId || randomUUID();
  const session = getSession(sessionId);

  try {
    const allChunks = await getKnowledgeBaseChunks();
    const relevantChunks = selectRelevantChunks(allChunks, message);

    // KB is set up but nothing matches this question — don't let the model guess, answer deterministically.
    const noKnowledgeMatch = isConfluenceConfigured() && relevantChunks.length === 0;

    const reply = noKnowledgeMatch
      ? NO_MATCH_REPLY
      : await getChatReply({
          systemPrompt: buildSystemPrompt(formatChunks(relevantChunks)),
          history: session.history,
          userMessage: message,
        });

    session.history.push({ role: 'user', content: message });
    session.history.push({ role: 'assistant', content: reply });

    if (detectHumanRequest(message)) {
      await maybeAlert(session, sessionId, AlertReason.HUMAN_REQUESTED, { userMessage: message, botReply: reply });
    }
    if (detectNegativeSentiment(message)) {
      await maybeAlert(session, sessionId, AlertReason.NEGATIVE_SENTIMENT, { userMessage: message, botReply: reply });
    }
    if (noKnowledgeMatch || detectNoAnswer(reply)) {
      await maybeAlert(session, sessionId, AlertReason.NO_ANSWER, { userMessage: message, botReply: reply });
    }

    res.json({ sessionId, reply });
  } catch (err) {
    console.error('[chat] failed:', err.message);
    res.status(502).json({ error: 'Failed to reach the chat model. Is Ollama running?' });
  }
});

app.post('/api/session/end', async (req, res) => {
  const { sessionId } = req.body || {};
  const session = sessionId && sessions.get(sessionId);

  if (session && session.history.length > 0) {
    try {
      const summary = await summarizeConversation(session.history);
      await sendAlert(AlertReason.SESSION_SUMMARY, { sessionId, summary });
    } catch (err) {
      console.error('[session/end] summary failed:', err.message);
    }
    sessions.delete(sessionId);
  }

  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`alrouter.ai support chatbot server listening on http://localhost:${PORT}`);
  console.log(`Confluence KB configured: ${isConfluenceConfigured()}`);
  console.log(`Alerting configured: ${isAlertingConfigured()}`);
});
