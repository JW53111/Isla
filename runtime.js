// Isla AI runtime — OpenAI-compatible API 的本地 Agent 运行时
// 职责：设置/会话/SOUL 人设/技能扫描/持久记忆/附件/生产力工具 + 流式对话与 AI 工具调用
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_SETTINGS = {
  memoryEnabled: true,
  skillsEnabled: true,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKey: '',
  systemPrompt: '',
  disabledSkills: [],
  maxToolRounds: 4,
};

// ---- 基础工具 ----
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(value) {
  return String(value || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// ---- 工作空间：桌宠目录下 .isla/（会话/记忆/技能/附件/工具数据都在这） ----
function workspacePaths(workspace) {
  const root = path.resolve(workspace || process.cwd());
  const data = ensureDir(path.join(root, '.isla'));
  return {
    root,
    data,
    sessions: ensureDir(path.join(data, 'sessions')),
    memory: ensureDir(path.join(data, 'memory')),
    skills: path.join(data, 'skills'),
    attachments: ensureDir(path.join(data, 'attachments')),
    settings: path.join(data, 'settings.json'),
    tasks: path.join(data, 'auto-tasks.json'),
  };
}

// ---- 设置（.isla/settings.json；API Key 支持 ISLA_API_KEY 环境变量覆盖） ----
function getSettings(workspace) {
  const paths = workspacePaths(workspace);
  const stored = readJson(paths.settings, {});
  return { ...DEFAULT_SETTINGS, ...stored, apiKey: process.env.ISLA_API_KEY || stored.apiKey || '' };
}

function saveSettings(workspace, patch) {
  const paths = workspacePaths(workspace);
  const settings = { ...getSettings(workspace), ...(patch || {}) };
  writeJson(paths.settings, settings);
  return { ...settings, apiKey: settings.apiKey ? '********' : '' };
}

// ---- 会话历史（.isla/sessions/*.json） ----
function listSessions(workspace) {
  const paths = workspacePaths(workspace);
  return fs.readdirSync(paths.sessions).filter((name) => name.endsWith('.json')).map((name) => {
    const session = readJson(path.join(paths.sessions, name), null);
    return session && { id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, messageCount: session.messages.length };
  }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

function sessionFile(paths, id) {
  return path.join(paths.sessions, safeName(id) + '.json');
}

function loadSession(workspace, id) {
  const paths = workspacePaths(workspace);
  return readJson(sessionFile(paths, id), { id, title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
}

function saveSession(workspace, session) {
  const paths = workspacePaths(workspace);
  session.updatedAt = Date.now();
  if (!session.createdAt) session.createdAt = session.updatedAt;
  if (!session.title && session.messages.length) {
    const firstUser = session.messages.find((m) => m.role === 'user');
    session.title = (firstUser && firstUser.content ? String(firstUser.content) : '新对话').slice(0, 24);
  }
  writeJson(sessionFile(paths, session.id), session);
  return session;
}

function deleteSession(workspace, id) {
  const paths = workspacePaths(workspace);
  const file = sessionFile(paths, id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ---- SOUL.md 人设（工作空间根目录） ----
function loadSoul(workspace) {
  const file = path.join(workspacePaths(workspace).root, 'SOUL.md');
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

function saveSoul(workspace, content) {
  fs.writeFileSync(path.join(workspacePaths(workspace).root, 'SOUL.md'), String(content || ''), 'utf8');
}

// ---- 技能：全局 ~/.isla/skills/<name>/SKILL.md + 工作空间 .isla/skills/<name>/SKILL.md ----
function skillRoots(workspace) {
  return [
    { dir: path.join(os.homedir(), '.isla', 'skills'), scope: 'global' },
    { dir: workspacePaths(workspace).skills, scope: 'workspace' },
  ];
}

function findSkill(workspace, name) {
  for (const root of skillRoots(workspace)) {
    const file = path.join(root.dir, safeName(name), 'SKILL.md');
    if (fs.existsSync(file)) return { name, file, scope: root.scope };
  }
  return null;
}

function listSkills(workspace) {
  const settings = getSettings(workspace);
  const disabled = settings.disabledSkills || [];
  const result = [];
  for (const root of skillRoots(workspace)) {
    if (!fs.existsSync(root.dir)) continue;
    for (const entry of fs.readdirSync(root.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root.dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const description = (text.match(/^description:\s*(.+)$/mi) || [])[1] || text.split('\n').find((line) => line.trim() && !line.startsWith('#')) || '';
      result.push({ name: entry.name, description: description.trim(), scope: root.scope, enabled: !disabled.includes(entry.name) });
    }
  }
  return result;
}

function loadSkill(workspace, name) {
  const found = findSkill(workspace, name);
  if (!found) throw new Error(`找不到技能：${name}`);
  return { name: found.name, scope: found.scope, content: fs.readFileSync(found.file, 'utf8') };
}

// 启用技能的完整内容（注入 system prompt）
function skillsPrompt(workspace) {
  const settings = getSettings(workspace);
  if (settings.skillsEnabled === false) return '';
  const parts = [];
  for (const skill of listSkills(workspace).filter((s) => s.enabled)) {
    const content = fs.readFileSync(findSkill(workspace, skill.name).file, 'utf8').trim();
    parts.push('【技能 ' + skill.name + '】\n' + content);
  }
  return parts.join('\n\n');
}

// ---- 附件（.isla/attachments/） ----
function saveAttachment(workspace, name, mediaType, dataBase64) {
  const buffer = Buffer.from(String(dataBase64 || ''), 'base64');
  if (buffer.length > MAX_FILE_BYTES) throw new Error('附件超过 256KB 限制');
  const fileName = `${Date.now()}-${safeName(name)}`;
  const file = path.join(workspacePaths(workspace).attachments, fileName);
  fs.writeFileSync(file, buffer);
  return { path: file, name: name || fileName, mediaType: mediaType || 'application/octet-stream' };
}

// 读取附件内容（供 read_file 工具使用）：只接受工作空间内路径，限制大小；
// 传裸文件名时按附件原名匹配（存储文件带时间戳前缀）
function readAttachmentText(workspace, ref) {
  const paths = workspacePaths(workspace);
  const refStr = String(ref || '').trim();
  let file;
  if (path.isAbsolute(refStr)) {
    if (!refStr.startsWith(paths.root + path.sep)) throw new Error('仅允许读取工作空间内的文件');
    file = refStr;
  } else if (refStr.includes('/') || refStr.includes('\\')) {
    file = path.resolve(paths.root, refStr);
    if (!file.startsWith(paths.root + path.sep)) throw new Error('仅允许读取工作空间内的文件');
  } else {
    const direct = path.join(paths.attachments, refStr);
    if (fs.existsSync(direct)) {
      file = direct;
    } else {
      const suffix = '-' + safeName(refStr);
      const match = fs.readdirSync(paths.attachments).find((name) => name.endsWith(suffix));
      if (!match) throw new Error(`找不到文件：${refStr}`);
      file = path.join(paths.attachments, match);
    }
  }
  if (!fs.existsSync(file)) throw new Error(`找不到文件：${refStr}`);
  if (fs.statSync(file).size > MAX_FILE_BYTES) throw new Error('文件超过 256KB 限制');
  const text = fs.readFileSync(file, 'utf8');
  if (text.indexOf('\0') >= 0) throw new Error('二进制文件无法读取');
  return text;
}

// ---- 持久记忆（.isla/memory/*.md） ----
function listMemory(workspace) {
  const dir = workspacePaths(workspace).memory;
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort().reverse().map((name) => {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const savedAt = (text.match(/^<!--\s*saved:\s*(.+?)\s*-->/m) || [])[1] || '';
    const body = text.replace(/^<!--[\s\S]*?-->\s*/m, '').trim();
    return { file: name, savedAt, preview: body.slice(0, 80) + (body.length > 80 ? '…' : ''), content: body };
  });
}

function addMemory(workspace, content, source) {
  const text = String(content || '').trim();
  if (!text) throw new Error('记忆内容为空');
  const file = path.join(workspacePaths(workspace).memory, Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.md');
  fs.writeFileSync(file, '<!-- source: ' + (source || 'unknown') + ', saved: ' + new Date().toISOString() + ' -->\n\n' + text + '\n', 'utf8');
  return { file: path.basename(file), savedAt: new Date().toISOString() };
}

function readMemory(workspace) {
  const dir = workspacePaths(workspace).memory;
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md')).map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n\n');
}

// ---- 生产力工具 ----
function toolData(workspace, name, fallback) {
  const file = path.join(workspacePaths(workspace).data, `${name}.json`);
  return [file, readJson(file, fallback)];
}

function runTool(workspace, tool, action, params) {
  params = params || {};
  const now = Date.now();
  if (tool === 'todolist') {
    const [file, items] = toolData(workspace, 'todolist', []);
    if (action === 'list') return items;
    if (action === 'add') { items.push({ id: crypto.randomUUID(), title: String(params.title || '未命名任务'), completed: false, createdAt: now }); }
    else {
      const item = items.find((entry) => entry.id === params.id);
      if (!item) throw new Error('找不到待办事项');
      if (action === 'complete' || action === 'uncomplete') item.completed = action === 'complete';
      if (action === 'update') item.title = String(params.title || item.title);
      if (action === 'delete') items.splice(items.indexOf(item), 1);
    }
    writeJson(file, items); return items;
  }
  if (tool === 'countdown') {
    const [file, items] = toolData(workspace, 'countdown', []);
    if (action === 'list') return items;
    if (action === 'add') items.push({ id: crypto.randomUUID(), name: String(params.name || '倒数日'), date: String(params.date || ''), createdAt: now });
    else { const index = items.findIndex((entry) => entry.id === params.id); if (index < 0) throw new Error('找不到倒数日'); if (action === 'delete') items.splice(index, 1); else Object.assign(items[index], params); }
    writeJson(file, items); return items;
  }
  if (tool === 'pomodoro') {
    const today = new Date().toISOString().slice(0, 10);
    const [file, state] = toolData(workspace, 'pomodoro', { status: 'idle', duration: 25, startedAt: null, remainingMs: null, today, completedToday: 0, history: [] });
    if (state.today !== today) { state.today = today; state.completedToday = 0; }
    if (action === 'status') return state;
    if (action === 'start') { state.status = 'running'; state.startedAt = now; state.duration = clampInt(params.duration || state.duration || 25, 1, 180); state.remainingMs = null; }
    if (action === 'pause' && state.status === 'running') { state.remainingMs = Math.max(0, state.duration * 60000 - (now - state.startedAt)); state.status = 'paused'; state.startedAt = null; }
    if (action === 'resume' && state.status === 'paused') { state.status = 'running'; state.startedAt = now - Math.max(0, state.duration * 60000 - (state.remainingMs != null ? state.remainingMs : state.duration * 60000)); }
    if (action === 'stop') { state.status = 'idle'; state.startedAt = null; state.remainingMs = null; }
    if (action === 'complete') { state.status = 'idle'; state.startedAt = null; state.remainingMs = null; state.completedToday += 1; state.history.push(now); }
    writeJson(file, state); return state;
  }
  throw new Error(`未知工具：${tool}`);
}

// ---- AI 工具定义（OpenAI function calling 格式） ----
const TOOL_FUNCTIONS = [
  { type: 'function', function: { name: 'todolist', description: '管理待办列表：list 列出、add 添加、complete 完成、uncomplete 取消完成、update 修改标题、delete 删除', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'add', 'complete', 'uncomplete', 'update', 'delete'] }, id: { type: 'string', description: '事项 id（add 时省略）' }, title: { type: 'string', description: '事项标题（add/update 用）' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'pomodoro', description: '番茄钟：status 查看、start 开始（duration 分钟）、pause 暂停、resume 继续、stop 停止、complete 完成一次', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'start', 'pause', 'resume', 'stop', 'complete'] }, duration: { type: 'number', description: '分钟数（start 用，默认 25）' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'countdown', description: '倒数日管理：list 列出、add 添加（name 名称、date 日期 YYYY-MM-DD）、delete 删除', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'add', 'delete'] }, id: { type: 'string' }, name: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'memory', description: '持久记忆：add 记住一件事（偏好/习惯/重要信息），list 查看已有记忆', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'list'] }, content: { type: 'string', description: '要记住的内容（add 用）' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'read_file', description: '读取工作空间内文本文件（如附件）的内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '文件路径或附件名' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'skill', description: '查看指定技能的完整说明', parameters: { type: 'object', properties: { name: { type: 'string', description: '技能名' } }, required: ['name'] } } },
];

// AI 调用工具的执行器：返回字符串（供 tool 消息回填）
function executeToolCall(workspace, name, args) {
  args = args || {};
  if (name === 'todolist') return JSON.stringify(runTool(workspace, 'todolist', args.action, args));
  if (name === 'pomodoro') return JSON.stringify(runTool(workspace, 'pomodoro', args.action, args));
  if (name === 'countdown') return JSON.stringify(runTool(workspace, 'countdown', args.action, args));
  if (name === 'memory') {
    if (args.action === 'add') return '已记住：' + addMemory(workspace, args.content, 'ai').file;
    return JSON.stringify(listMemory(workspace));
  }
  if (name === 'read_file') return readAttachmentText(workspace, args.path);
  if (name === 'skill') { const s = loadSkill(workspace, args.name); return '【' + s.name + '】（' + s.scope + '）\n' + s.content; }
  throw new Error('未知工具：' + name);
}

// ---- 提示词构建 ----
function buildSystemPrompt(workspace, defaultPersona) {
  const settings = getSettings(workspace);
  const name = String((defaultPersona && defaultPersona.name) || 'Isla');
  const parts = [`你是${name}，运行在用户桌面上的 AI Agent。请用自然、清楚的语气回答。根据用户请求使用已提供的工具；工具执行后如实说明结果，不要声称完成了未成功的操作。只能通过已提供的工具访问工作空间，不要假设自己能运行任意命令。`];
  const soul = (settings.systemPrompt || '').trim() || loadSoul(workspace).trim();
  if (soul) parts.push(soul);
  const skills = skillsPrompt(workspace);
  if (skills) parts.push('## 可用技能说明\n' + skills);
  if (settings.memoryEnabled) {
    const memory = readMemory(workspace).trim();
    if (memory) parts.push('## 持久记忆（过去的对话中记住的信息）\n' + memory);
  }
  return parts.join('\n\n');
}

function buildUserContent(workspace, prompt, attachments) {
  const parts = [];
  for (const attachment of attachments || []) {
    const head = '[附件: ' + (attachment.name || attachment.path || '') + ']\n路径: ' + (attachment.path || '');
    parts.push(attachment.text ? head + '\n内容:\n' + attachment.text : head);
  }
  parts.push(prompt);
  return parts.join('\n\n');
}

// ---- 流式 SSE 解析：累积文本增量 + 工具调用片段 ----
async function parseSse(body, onEvent) {
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let text = '';
  const slots = [];
  for await (const chunk of body) {
    buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json;
      try { json = JSON.parse(payload); } catch (_) { continue; }
      const choice = json.choices && json.choices[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        if (onEvent) onEvent({ type: 'chunk', text: delta.content });
      }
      for (const tc of delta.tool_calls || []) {
        const slot = slots[tc.index] || (slots[tc.index] = { index: tc.index, id: '', name: '', argsStr: '' });
        if (tc.id) slot.id = tc.id;
        if (tc.function && tc.function.name) slot.name += tc.function.name;
        if (tc.function && tc.function.arguments) slot.argsStr += tc.function.arguments;
      }
    }
  }
  const toolCalls = slots.filter(Boolean).map((tc) => {
    let argumentsObj = {};
    try { argumentsObj = tc.argsStr ? JSON.parse(tc.argsStr) : {}; } catch (_) { argumentsObj = {}; }
    return { id: tc.id || ('call_' + crypto.randomBytes(6).toString('hex')), name: tc.name, arguments: argumentsObj };
  });
  const assistantMessage = toolCalls.length
    ? { role: 'assistant', content: text || null, tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) }
    : { role: 'assistant', content: text };
  return { text, toolCalls, assistantMessage };
}

// ---- 对话：流式输出 + 工具调用循环 ----
async function askAi(workspace, prompt, attachments, history, onEvent, defaultPersona, signal) {
  const settings = getSettings(workspace);
  if (!settings.apiKey || !settings.model) throw new Error('请先在设置中填写 API Key 和模型');
  const base = String(settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const messages = [];
  const system = buildSystemPrompt(workspace, defaultPersona);
  if (system) messages.push({ role: 'system', content: system });
  for (const m of history || []) {
    if (m && (m.role === 'user' || m.role === 'assistant') && m.content) messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: 'user', content: buildUserContent(workspace, prompt, attachments) });

  const maxRounds = clampInt(settings.maxToolRounds, 0, 10);
  let toolRounds = 0;
  let requestRounds = 0;
  for (;;) {
    requestRounds++;
    const body = { model: settings.model, messages, stream: true };
    if (maxRounds > 0) body.tools = TOOL_FUNCTIONS;
    let response;
    try {
      response = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + settings.apiKey },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal && signal.aborted) throw new Error('已停止生成');
      throw new Error('无法连接 AI 服务：' + (e && e.message ? e.message : e));
    }
    if (!response.ok) {
      // 个别服务不支持 tools 参数：去掉工具重试一次
      if (body.tools && requestRounds === 1) {
        const retry = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + settings.apiKey },
          body: JSON.stringify({ model: settings.model, messages, stream: false }),
          signal,
        });
        if (retry.ok) {
          const data = await retry.json();
          const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
          if (onEvent && text) onEvent({ type: 'chunk', text });
          return { text: text || '没有收到回复。', rounds: requestRounds };
        }
      }
      throw new Error('AI 服务返回 HTTP ' + response.status);
    }
    if (!response.body) throw new Error('AI 服务未返回流式响应');
    const parsed = await parseSse(response.body, onEvent);
    if (!parsed.toolCalls.length) return { text: parsed.text, rounds: requestRounds };
    if (toolRounds >= maxRounds) {
      if (onEvent) onEvent({ type: 'chunk', text: '\n\n（已达到工具调用轮数上限）' });
      return { text: parsed.text, rounds: requestRounds };
    }
    toolRounds++;
    messages.push(parsed.assistantMessage);
    for (const call of parsed.toolCalls) {
      let result;
      try {
        result = executeToolCall(workspace, call.name, call.arguments);
      } catch (e) {
        result = '工具执行失败：' + (e && e.message ? e.message : e);
      }
      if (onEvent) onEvent({ type: 'tool', name: call.name, result: typeof result === 'string' ? result.slice(0, 200) : String(result).slice(0, 200) });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
}

module.exports = {
  workspacePaths, getSettings, saveSettings,
  listSessions, loadSession, saveSession, deleteSession,
  loadSoul, saveSoul,
  listSkills, loadSkill,
  saveAttachment, readAttachmentText,
  listMemory, addMemory, readMemory,
  runTool,
  askAi,
};
