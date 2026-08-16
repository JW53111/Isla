// AI chat window controller — talks to the main process, which proxies the text API

const api = window.electronAPI;

const messagesEl = document.getElementById('chat-messages');
const inputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('btn-send');
const settingsPanel = document.getElementById('settings-panel');
const btnSettings = document.getElementById('btn-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnClear = document.getElementById('btn-clear');
const btnClose = document.getElementById('btn-close');
const cfgBaseUrl = document.getElementById('cfg-base-url');
const cfgApiKey = document.getElementById('cfg-api-key');
const cfgModel = document.getElementById('cfg-model');
const settingsHint = document.getElementById('settings-hint');

const messages = [];

const ERROR_TEXT = {
  'missing-key': '还没有配置 API Key，点右上角 ⚙ 填写后就能聊天啦',
  timeout: '回复超时了，再试一次吧',
  'empty-reply': '她好像走神了…再试一次吧',
};

function errorText(err) {
  if (!err) return '发送失败了，请稍后再试';
  if (ERROR_TEXT[err]) return ERROR_TEXT[err];
  if (String(err).startsWith('http-4')) return 'API 拒绝了请求（' + err + '），检查一下 Key 和模型名';
  if (String(err).startsWith('http-5')) return 'API 服务暂时不可用（' + err + '）';
  return '发送失败：' + err;
}

function appendMessage(role, content, extraClass) {
  const el = document.createElement('div');
  el.className = 'msg ' + role + (extraClass ? ' ' + extraClass : '');
  el.textContent = content;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

async function init() {
  if (!api) {
    appendMessage('error', '没有找到主进程接口，聊天不可用');
    return;
  }
  const cfg = await api.getApiConfig();
  cfgBaseUrl.value = cfg.baseUrl || '';
  cfgApiKey.value = cfg.apiKey || '';
  cfgModel.value = cfg.model || '';
  if (!cfg.apiKey) settingsPanel.classList.remove('hidden');

  const history = await api.getChatHistory();
  for (const m of history.messages || []) {
    messages.push(m);
    appendMessage(m.role, m.content);
  }
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || !api) return;
  inputEl.value = '';
  messages.push({ role: 'user', content: text });
  appendMessage('user', text);

  sendBtn.disabled = true;
  const loadingEl = appendMessage('assistant', '…', 'loading');
  const res = await api.sendChat(text);
  loadingEl.remove();
  sendBtn.disabled = false;

  if (res && res.error) {
    appendMessage('error', errorText(res.error));
  } else {
    const reply = (res && res.reply) || '';
    messages.push({ role: 'assistant', content: reply });
    appendMessage('assistant', reply);
  }
  inputEl.focus();
}

btnSend.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});

btnSettings.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

btnSaveSettings.addEventListener('click', async () => {
  await api.setApiConfig({
    baseUrl: cfgBaseUrl.value.trim(),
    apiKey: cfgApiKey.value.trim(),
    model: cfgModel.value.trim(),
  });
  settingsHint.textContent = '已保存 ✓';
  setTimeout(() => (settingsHint.textContent = ''), 1500);
});

btnClear.addEventListener('click', async () => {
  messages.length = 0;
  messagesEl.innerHTML = '';
  await api.clearChatHistory();
});

btnClose.addEventListener('click', () => {
  api.closeChat();
});

init();
