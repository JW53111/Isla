// Isla AI 工作台控制器 — 流式对话、会话历史、持久记忆、技能、附件拖拽、番茄钟/待办/倒数日
const api = window.electronAPI;
const $ = (id) => document.getElementById(id);
const petName = new URLSearchParams(location.search).get('petName') || 'Isla';

const MAX_FILE_BYTES = 256 * 1024;
const TEXT_EXTS = /\.(md|txt|json|js|ts|jsx|tsx|py|css|html?|xml|csv|ya?ml|log|ini|env|sh|bat|ps1|java|c|cpp|go|rs)$/i;

const state = {
  session: { id: crypto.randomUUID(), title: '新对话', createdAt: Date.now(), messages: [] },
  attachments: [],
  pendingId: null,
};

// ---- 消息区 ----
function appendMessage(role, text, cls) {
  const el = document.createElement('div');
  el.className = 'msg ' + role + (cls ? ' ' + cls : '');
  el.textContent = text;
  $('messages').appendChild(el);
  $('messages').scrollTop = $('messages').scrollHeight;
  return el;
}

function renderSessionMessages() {
  $('messages').innerHTML = '';
  for (const m of state.session.messages || []) {
    if (m.role === 'tool') appendMessage('tool', m.content);
    else appendMessage(m.role, m.content || '');
  }
}

// ---- 会话面板 ----
async function refreshSessions(selectId) {
  const list = await api.ai.listSessions();
  const sel = $('sessions');
  sel.innerHTML = '';
  for (const item of list) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.title || '新对话'}（${item.messageCount} 条）`;
    sel.appendChild(option);
  }
  if (selectId) sel.value = selectId;
}

async function openSession(id) {
  state.session = await api.ai.getSession(id);
  state.attachments = [];
  renderAttachments();
  renderSessionMessages();
}

async function newSession() {
  state.session = { id: crypto.randomUUID(), title: '新对话', createdAt: Date.now(), messages: [] };
  state.attachments = [];
  renderAttachments();
  renderSessionMessages();
  await refreshSessions();
}

async function deleteCurrentSession() {
  if (!confirm('删除当前会话？')) return;
  await api.ai.deleteSession(state.session.id);
  await newSession();
}

async function showMemory() {
  const list = await api.ai.listMemory();
  $('sessions-output').textContent = list.length
    ? list.map((m) => `[${m.savedAt || m.file}]\n${m.content}`).join('\n\n')
    : '（还没有记忆。你可以直接在对话里让 Isla 记住什么，或点「记住当前对话要点」。）';
}

async function rememberLastExchange() {
  const msgs = state.session.messages || [];
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
  if (!lastUser) { $('sessions-output').textContent = '当前会话还没有对话内容。'; return; }
  const content = `【${state.session.title}】\n用户：${lastUser.content}\nIsla：${lastAssistant ? lastAssistant.content : '（无回复）'}`;
  await api.ai.addMemory(content);
  $('sessions-output').textContent = '已记住最近一轮对话。';
}

// ---- 附件：拖拽 / 选择、文本提取、分块 base64 落盘 ----
function isTextFile(file) {
  return file.type.startsWith('text/') || TEXT_EXTS.test(file.name);
}

function toBase64(buf) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function renderAttachments() {
  $('attachments').innerHTML = '';
  state.attachments.forEach((item, index) => {
    const chip = document.createElement('span');
    chip.className = 'attachment';
    const label = document.createElement('span');
    label.textContent = item.name;
    const rm = document.createElement('span');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.onclick = () => { state.attachments.splice(index, 1); renderAttachments(); };
    chip.appendChild(label);
    chip.appendChild(rm);
    $('attachments').appendChild(chip);
  });
}

async function addFiles(files) {
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      appendMessage('error', `${file.name} 超过 256KB 限制，已跳过`);
      continue;
    }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const text = isTextFile(file) ? await file.text() : '';
      const saved = await api.ai.saveAttachment(file.name, file.type, toBase64(buf));
      state.attachments.push({ name: file.name, path: saved.path, mediaType: file.type, text });
    } catch (e) {
      appendMessage('error', `附件 ${file.name} 保存失败：${e.message || e}`);
    }
  }
  renderAttachments();
}

// ---- 对话（流式） ----
async function send() {
  const prompt = $('prompt').value.trim();
  if (!prompt || state.pendingId) return;
  $('prompt').value = '';
  appendMessage('user', prompt);
  state.session.messages.push({ role: 'user', content: prompt });
  const requestId = crypto.randomUUID();
  state.pendingId = requestId;
  $('btn-stop').hidden = false;
  const bubble = appendMessage('assistant', '');
  let acc = '';
  api.ai.sendChat({ requestId, prompt, attachments: state.attachments, history: state.session.messages.slice(0, -1) });

  const finish = async () => {
    if (state.pendingId !== requestId) return;
    state.pendingId = null;
    delete pendingHandlers[requestId];
    $('btn-stop').hidden = true;
    state.attachments = [];
    renderAttachments();
    state.session.messages.push({ role: 'assistant', content: bubble.textContent || acc });
    await api.ai.saveSession(state.session);
    await refreshSessions(state.session.id);
  };

  // 事件处理在 init 里统一注册，这里用请求级回调包装
  pendingHandlers[requestId] = {
    onEvent: (ev) => {
      if (ev.type === 'chunk') { acc += ev.text; bubble.textContent = acc; $('messages').scrollTop = $('messages').scrollHeight; }
      else if (ev.type === 'tool') { appendMessage('tool', `🔧 ${ev.name} → ${ev.result}`); }
      else if (ev.type === 'done') { bubble.textContent = bubble.textContent || ev.text || '（无回复）'; finish(); }
      else if (ev.type === 'error') { bubble.className = 'msg error'; bubble.textContent = ev.message || '发送失败'; finish(); }
      else if (ev.type === 'cancelled') { bubble.textContent = bubble.textContent || '（已停止）'; finish(); }
    },
  };
}
const pendingHandlers = {};
api.ai.onChatEvent((ev) => {
  const handler = pendingHandlers[ev.requestId];
  if (handler) handler.onEvent(ev);
});

// ---- 工具面板 ----
async function refreshTodo() {
  const items = await api.ai.runTool('todolist', 'list', {});
  const ul = $('todo-list');
  ul.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!item.completed;
    cb.onchange = () => api.ai.runTool('todolist', cb.checked ? 'complete' : 'uncomplete', { id: item.id }).then(refreshTodo);
    const span = document.createElement('span');
    span.textContent = item.title;
    if (item.completed) span.className = 'done';
    const del = document.createElement('button');
    del.className = 'small ghost';
    del.textContent = '删除';
    del.onclick = () => api.ai.runTool('todolist', 'delete', { id: item.id }).then(refreshTodo);
    li.appendChild(cb); li.appendChild(span); li.appendChild(del);
    ul.appendChild(li);
  }
}

let pomoState = { status: 'idle', duration: 25, startedAt: null, remainingMs: null, completedToday: 0 };
let pomoAutoDone = false;

function pomoRemainingSeconds() {
  if (pomoState.status === 'running' && pomoState.startedAt) {
    return Math.max(0, Math.ceil((pomoState.duration * 60 - (Date.now() - pomoState.startedAt) / 1000)));
  }
  if (pomoState.status === 'paused') {
    return Math.max(0, Math.ceil((pomoState.remainingMs != null ? pomoState.remainingMs : pomoState.duration * 60000) / 1000));
  }
  return pomoState.duration * 60;
}

function renderPomo() {
  const sec = pomoRemainingSeconds();
  $('pomo-clock').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  $('pomo-info').textContent = `今日完成：${pomoState.completedToday || 0} 次${pomoState.status === 'running' ? ' · 进行中' : pomoState.status === 'paused' ? ' · 已暂停' : ''}`;
}

async function pomoAction(action, params) {
  pomoState = await api.ai.runTool('pomodoro', action, params);
  if (action === 'start') pomoAutoDone = false;
  renderPomo();
}

async function pomoTick() {
  if (!pomoState || (pomoState.status !== 'running' && pomoState.status !== 'paused')) return;
  if (pomoState.status === 'running' && pomoState.startedAt && Date.now() - pomoState.startedAt >= pomoState.duration * 60000) {
    if (!pomoAutoDone) {
      pomoAutoDone = true;
      pomoState = await api.ai.runTool('pomodoro', 'complete', {});
      api.notify({ title: 'Isla 番茄钟', body: '一个番茄完成啦，休息一下吧～', type: 'pomodoro-done' });
      appendMessage('tool', '🍅 番茄钟完成！休息一下吧～');
    }
  }
  renderPomo();
}

async function refreshCountdown() {
  const items = await api.ai.runTool('countdown', 'list', {});
  const ul = $('cd-list');
  ul.innerHTML = '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const item of items) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    const target = new Date(item.date + 'T00:00:00');
    const days = Math.ceil((target - today) / 86400000);
    const daysText = isNaN(days) ? '（无日期）' : days >= 0 ? `还剩 ${days} 天` : `已过 ${-days} 天`;
    span.textContent = `${item.name}（${item.date || '无日期'}）`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = daysText;
    const del = document.createElement('button');
    del.className = 'small ghost';
    del.textContent = '删除';
    del.onclick = () => api.ai.runTool('countdown', 'delete', { id: item.id }).then(refreshCountdown);
    li.appendChild(span); li.appendChild(meta); li.appendChild(del);
    ul.appendChild(li);
  }
}

// ---- 技能面板 ----
async function refreshSkills() {
  const skills = await api.ai.listSkills();
  const ul = $('skill-list');
  ul.innerHTML = '';
  if (!skills.length) {
    const li = document.createElement('li');
    li.textContent = '（还没有技能。在 ~/.isla/skills/ 或工作空间 .isla/skills/ 放一个含 SKILL.md 的文件夹即可）';
    ul.appendChild(li);
    return;
  }
  for (const skill of skills) {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!skill.enabled;
    cb.onchange = async () => {
      const settings = await api.ai.getSettings();
      const disabled = new Set(settings.disabledSkills || []);
      cb.checked ? disabled.delete(skill.name) : disabled.add(skill.name);
      await api.ai.setSettings({ disabledSkills: [...disabled] });
    };
    const span = document.createElement('span');
    span.textContent = `${skill.name}（${skill.scope === 'global' ? '全局' : '工作空间'}）${skill.description ? ' — ' + skill.description : ''}`;
    const view = document.createElement('button');
    view.className = 'small ghost';
    view.textContent = '查看';
    view.onclick = async () => {
      try {
        const s = await api.ai.getSkill(skill.name);
        $('skill-output').textContent = `【${s.name}】（${s.scope}）\n${s.content}`;
      } catch (e) { $('skill-output').textContent = e.message || String(e); }
    };
    li.appendChild(cb); li.appendChild(span); li.appendChild(view);
    ul.appendChild(li);
  }
}

// ---- 设置面板 ----
async function loadSettings() {
  const settings = await api.ai.getSettings();
  $('base-url').value = settings.baseUrl || '';
  $('api-key').value = settings.apiKey || '';
  $('model').value = settings.model || '';
  $('system-prompt').value = settings.systemPrompt || '';
  $('memory-enabled').checked = settings.memoryEnabled !== false;
  $('skills-enabled').checked = settings.skillsEnabled !== false;
  $('soul').value = await api.ai.getSoul();
}

async function saveSettings() {
  const current = await api.ai.getSettings();
  const apiKeyInput = $('api-key').value.trim();
  await api.ai.setSettings({
    baseUrl: $('base-url').value.trim(),
    apiKey: apiKeyInput || current.apiKey, // 留空则保留原 Key
    model: $('model').value.trim(),
    systemPrompt: $('system-prompt').value,
    memoryEnabled: $('memory-enabled').checked,
    skillsEnabled: $('skills-enabled').checked,
  });
  appendMessage('tool', '设置已保存');
}

// ---- 面板切换 ----
function togglePanel(id, btn) {
  const panel = $(id);
  const wasHidden = panel.classList.contains('hidden');
  for (const other of ['panel-sessions', 'panel-tools', 'panel-skills', 'panel-settings']) {
    $(other).classList.add('hidden');
  }
  if (wasHidden) panel.classList.remove('hidden');
  if (btn) btn.classList.toggle('active', wasHidden);
}

// ---- 初始化 ----
async function init() {
  document.title = petName + ' AI 工作台';
  $('app-title').textContent = petName + ' AI 工作台';
  await loadSettings();
  await refreshSessions();
  const list = await api.ai.listSessions();
  if (list.length) await openSession(list[0].id);
  else renderSessionMessages();
  await Promise.all([refreshTodo(), pomoAction('status', {}), refreshCountdown(), refreshSkills()]);

  // 会话面板
  $('sessions').onchange = () => openSession($('sessions').value);
  $('new-session').onclick = newSession;
  $('del-session').onclick = deleteCurrentSession;
  $('save-soul').onclick = async () => { await api.ai.setSoul($('soul').value); $('sessions-output').textContent = 'SOUL.md 已保存'; };
  $('memory-btn').onclick = showMemory;
  $('memory-add-btn').onclick = rememberLastExchange;

  // 工具面板
  $('todo-add').onclick = async () => {
    const title = $('todo-title').value.trim();
    if (!title) return;
    await api.ai.runTool('todolist', 'add', { title });
    $('todo-title').value = '';
    refreshTodo();
  };
  $('todo-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('todo-add').click(); });
  $('pomo-start').onclick = () => pomoAction('start', { duration: $('pomo-duration').value });
  $('pomo-pause').onclick = () => pomoAction('pause', {});
  $('pomo-resume').onclick = () => pomoAction('resume', {});
  $('pomo-stop').onclick = () => pomoAction('stop', {});
  $('pomo-complete').onclick = async () => {
    await pomoAction('complete', {});
    api.notify({ title: 'Isla 番茄钟', body: '一个番茄完成啦，休息一下吧～', type: 'pomodoro-done' });
    appendMessage('tool', '🍅 番茄钟完成！休息一下吧～');
  };
  setInterval(pomoTick, 500);
  $('cd-add').onclick = async () => {
    const name = $('cd-name').value.trim();
    const date = $('cd-date').value;
    if (!name || !date) { appendMessage('error', '请填写名称和日期'); return; }
    await api.ai.runTool('countdown', 'add', { name, date });
    $('cd-name').value = '';
    $('cd-date').value = '';
    refreshCountdown();
  };

  // 技能面板
  $('btn-skills').onclick = () => { togglePanel('panel-skills', $('btn-skills')); refreshSkills(); };

  // 设置面板
  $('save-settings').onclick = saveSettings;

  // 面板按钮
  $('btn-sessions').onclick = () => togglePanel('panel-sessions', $('btn-sessions'));
  $('btn-tools').onclick = () => togglePanel('panel-tools', $('btn-tools'));
  $('btn-settings').onclick = () => togglePanel('panel-settings', $('btn-settings'));
  $('btn-close').onclick = () => window.close();
  $('btn-stop').onclick = () => {
    if (state.pendingId) api.ai.cancelChat(state.pendingId);
  };

  // 发送
  $('composer').addEventListener('submit', (event) => { event.preventDefault(); send(); });

  // 附件：文件选择 + 拖拽
  $('files').addEventListener('change', async (event) => {
    await addFiles(event.target.files);
    event.target.value = '';
  });
  const messagesEl = $('messages');
  messagesEl.addEventListener('dragover', (e) => { e.preventDefault(); messagesEl.classList.add('dragover'); });
  messagesEl.addEventListener('dragleave', () => messagesEl.classList.remove('dragover'));
  messagesEl.addEventListener('drop', (e) => {
    e.preventDefault();
    messagesEl.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
}

init().catch((error) => appendMessage('error', error.message || String(error)));
