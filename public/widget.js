(function () {
  // Guard against the widget being embedded/loaded more than once on the same page.
  if (document.getElementById('alrouter-chat-widget-host')) return;

  const currentScript = document.currentScript;
  const API_BASE = (currentScript && currentScript.getAttribute('data-api-base')) || '';
  const STORAGE_KEY = 'alrouter_chat_session_id';
  const HISTORY_KEY = 'alrouter_chat_history';

  function getSessionId() {
    let id = sessionStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  }

  const sessionId = getSessionId();

  const isEnglish = navigator.language.toLowerCase().startsWith('en');
  const UI = isEnglish ? {
    header: 'AlRouter.ai Support',
    placeholder: 'Type your question',
    send: 'Send',
    typing: 'Typing...',
    greeting: "Hi! I'm an AI-powered support chatbot for AlRouter.ai. I'll do my best to help, but as an AI I may occasionally give incomplete or inaccurate answers. How can I help you today?",
    error: 'Sorry, something went wrong. Please try again in a moment.',
    launcherLabel: 'Open chat',
  } : {
    header: 'alrouter.ai 고객센터',
    placeholder: '궁금한 점을 입력하세요',
    send: '전송',
    typing: '답변 작성 중...',
    greeting: '안녕하세요! 저는 AI 기반 alrouter.ai 고객센터 챗봇입니다. 최선을 다해 답변드리지만, AI 특성상 응대가 미흡하거나 부정확할 수 있는 점 양해 부탁드립니다. 무엇을 도와드릴까요?',
    error: '죄송합니다, 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    launcherLabel: '채팅 열기',
  };

  // Visible chat log persists across reloads/panel toggles for the life of the
  // tab (sessionStorage), separate from the server-side conversation history.
  function loadChatLog() {
    try {
      return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  }

  const chatLog = loadChatLog();

  const host = document.createElement('div');
  host.id = 'alrouter-chat-widget-host';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      .launcher {
        position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px;
        border-radius: 50%; background: #4f46e5; color: #fff; border: none;
        cursor: pointer; font-size: 24px; box-shadow: 0 4px 12px rgba(0,0,0,.2);
        z-index: 999999;
      }
      .panel {
        position: fixed; bottom: 88px; right: 20px; width: 340px; max-width: calc(100vw - 40px);
        height: 480px; max-height: calc(100vh - 120px); background: #fff; border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0,0,0,.25); display: none; flex-direction: column;
        overflow: hidden; z-index: 999999;
      }
      .panel.open { display: flex; }
      .header {
        background: #4f46e5; color: #fff; padding: 12px 16px; font-weight: 600; font-size: 14px;
      }
      .messages { flex: 1; overflow-y: auto; padding: 12px; font-size: 14px; position: relative; }
      .messages::before {
        content: '';
        position: absolute;
        inset: 0;
        background-image: url('${API_BASE}/assets/logo.svg');
        background-repeat: no-repeat;
        background-position: center;
        background-size: 140px;
        opacity: 0.06;
        pointer-events: none;
      }
      .messages .msg { position: relative; }
      .msg { margin-bottom: 10px; line-height: 1.4; white-space: pre-wrap; }
      .msg.user { text-align: right; color: #111; }
      .msg.bot { text-align: left; color: #333; }
      .msg.user .bubble { background: #4f46e5; color: #fff; }
      .msg.bot .bubble { background: #f1f1f4; color: #111; }
      .bubble { display: inline-block; padding: 8px 12px; border-radius: 12px; max-width: 85%; }
      .input-row { display: flex; border-top: 1px solid #eee; padding: 8px; }
      .input-row input {
        flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; font-size: 14px;
      }
      .input-row button {
        margin-left: 8px; background: #4f46e5; color: #fff; border: none; border-radius: 8px;
        padding: 8px 14px; cursor: pointer; font-size: 14px;
      }
      .typing { font-size: 12px; color: #888; padding: 0 12px 8px; }
    </style>
    <button class="launcher" aria-label="${UI.launcherLabel}">💬</button>
    <div class="panel">
      <div class="header">${UI.header}</div>
      <div class="messages"></div>
      <div class="typing" hidden>${UI.typing}</div>
      <div class="input-row">
        <input type="text" placeholder="${UI.placeholder}" />
        <button type="button">${UI.send}</button>
      </div>
    </div>
  `;

  const launcher = shadow.querySelector('.launcher');
  const panel = shadow.querySelector('.panel');
  const messagesEl = shadow.querySelector('.messages');
  const typingEl = shadow.querySelector('.typing');
  const input = shadow.querySelector('input');
  const sendBtn = shadow.querySelector('.input-row button');

  launcher.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && chatLog.length === 0) {
      addMessage('bot', UI.greeting);
    }
  });

  function renderMessage(role, text) {
    const row = document.createElement('div');
    row.className = `msg ${role}`;
    const bubble = document.createElement('span');
    bubble.className = 'bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, text) {
    renderMessage(role, text);
    chatLog.push({ role, text });
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(chatLog));
  }

  // Restore whatever was on screen before this reload (same tab/session only).
  chatLog.forEach((m) => renderMessage(m.role, m.text));

  let lastSendAt = 0;

  async function sendMessage() {
    // Guards against a second Enter keydown firing right after IME composition
    // ends (seen on macOS Chrome/Safari with Korean input), which otherwise
    // re-submits a leftover fragment of the just-cleared input as a new message.
    const now = Date.now();
    if (now - lastSendAt < 300) return;

    const text = input.value.trim();
    if (!text) return;
    lastSendAt = now;
    input.value = '';
    addMessage('user', text);
    typingEl.hidden = false;

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'request failed');
      addMessage('bot', data.reply);
    } catch (err) {
      addMessage('bot', UI.error);
    } finally {
      typingEl.hidden = true;
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    // isComposing / keyCode 229 guards against Enter being used to confirm
    // an IME candidate (Korean/Japanese/Chinese) instead of submitting.
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) sendMessage();
  });

  window.addEventListener('pagehide', () => {
    navigator.sendBeacon(
      `${API_BASE}/api/session/end`,
      new Blob([JSON.stringify({ sessionId })], { type: 'application/json' })
    );
  });
})();
