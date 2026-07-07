const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3';

// Low temperature: support answers must be consistent and stick to the KB,
// not creative. num_ctx raised from the 2048 default so KB chunks + history fit.
const CHAT_OPTIONS = {
  temperature: 0.2,
  num_ctx: 8192,
};

// Only the most recent turns are sent to the model. Long histories slow down
// generation and dilute the system prompt's influence on small local models.
const MAX_HISTORY_MESSAGES = 8;

async function chatCompletion(messages) {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false, options: CHAT_OPTIONS }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.message?.content?.trim() || '';
}

// Returns one embedding vector per input text, or null if the embed model is
// unavailable (callers fall back to keyword retrieval).
export async function embedTexts(texts) {
  if (!texts.length) return [];
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: texts }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    return Array.isArray(data.embeddings) && data.embeddings.length === texts.length
      ? data.embeddings
      : null;
  } catch (err) {
    console.error(`[ollama] embedding failed (model: ${OLLAMA_EMBED_MODEL}):`, err.message);
    return null;
  }
}

const FEW_SHOT_EXAMPLES = `--- 답변 예시 ---
[예시 1]
고객: API 키는 어디서 발급받나요?
챗봇: API 키는 대시보드의 [설정 > API 키] 메뉴에서 발급받으실 수 있습니다. 발급 후에는 보안을 위해 키를 안전한 곳에 보관해주세요.

[예시 2]
고객: 라우팅이 갑자기 안 돼요.
챗봇: 불편을 드려 죄송합니다. 먼저 대시보드에서 라우팅 규칙이 활성화되어 있는지 확인해주시겠어요? 확인 후에도 동일하다면 발생 시각과 함께 알려주시면 확인해드리겠습니다.

[예시 3]
고객: 지원하는 모델 목록이 궁금해요.
챗봇: 정확한 답변을 위해 담당자에게 전달했습니다. 확인 후 안내드리겠습니다.
(참고 문서에 답이 없는 경우의 예시)`;

export function buildSystemPrompt(kbContext) {
  const rules = [
    '너는 alrouter.ai 고객센터 상담 챗봇이다.',
    '반드시 한국어로만 답한다. 다른 언어를 섞지 않는다.',
    '답변은 2~3문장, 필요할 때만 목록을 사용한다. 불필요한 설명을 덧붙이지 않는다.',
    '아래 "참고 문서"에 있는 내용만 사실로 사용한다. 참고 문서에 없는 내용은 지어내지 않는다.',
    '참고 문서에 답이 없으면 "정확한 답변을 위해 담당자에게 전달했습니다"라고만 답한다.',
  ];

  const context = kbContext
    ? `--- 참고 문서 ---\n${kbContext}`
    : '--- 참고 문서 ---\n(없음 — 참고 문서에 없는 질문은 위 규칙대로 담당자 전달 안내만 한다)';

  return rules.join('\n') + '\n\n' + FEW_SHOT_EXAMPLES + '\n\n' + context;
}

export async function getChatReply({ systemPrompt, history, userMessage }) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-MAX_HISTORY_MESSAGES),
    { role: 'user', content: userMessage },
  ];
  return chatCompletion(messages);
}

export async function summarizeConversation(history) {
  if (history.length === 0) return '';
  const messages = [
    {
      role: 'system',
      content: 'Summarize the following customer support conversation in 2-3 sentences for an internal staff notification. Include the customer\'s main issue and whether it was resolved.',
    },
    ...history,
  ];
  return chatCompletion(messages);
}
