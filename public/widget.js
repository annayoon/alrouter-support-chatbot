(function () {
  const currentScript = document.currentScript;
  const API_BASE = (currentScript && currentScript.getAttribute('data-api-base')) || '';
  const STORAGE_KEY = 'alrouter_chat_session_id';

  function getSessionId() {
    let id = sessionStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  }

  const sessionId = getSessionId();

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
      .messages { flex: 1; overflow-y: auto; padding: 12px; font-size: 14px; }
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
    <button class="launcher" aria-label="Open chat">💬</button>
    <div class="panel">
      <div class="header">alrouter.ai 고객센터</div>
      <div class="messages"></div>
      <div class="typing" hidden>답변 작성 중...</div>
      <div class="input-row">
        <input type="text" placeholder="궁금한 점을 입력하세요" />
        <button type="button">전송</button>
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
    if (panel.classList.contains('open') && messagesEl.children.length === 0) {
      addMessage('bot', '안녕하세요! alrouter.ai 고객센터입니다. 무엇을 도와드릴까요?');
    }
  });

  function addMessage(role, text) {
    const row = document.createElement('div');
    row.className = `msg ${role}`;
    const bubble = document.createElement('span');
    bubble.className = 'bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
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
      addMessage('bot', '죄송합니다, 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      typingEl.hidden = true;
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  window.addEventListener('pagehide', () => {
    navigator.sendBeacon(
      `${API_BASE}/api/session/end`,
      new Blob([JSON.stringify({ sessionId })], { type: 'application/json' })
    );
  });
})();
