const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

async function chatCompletion(messages) {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.message?.content?.trim() || '';
}

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

  return rules.join('\n') + '\n\n' + context;
}

export async function getChatReply({ systemPrompt, history, userMessage }) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
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
