const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口 / 显示
  showContextMenu: (currentActionId) => ipcRenderer.send('show-context-menu', currentActionId),
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', width, height),
  moveWindow: (dx, dy, opts) => ipcRenderer.send('move-window', dx, dy, opts || {}),
  getDisplayConfig: () => ipcRenderer.invoke('get-display-config'),

  // 设置（userData/settings.json，主进程为权威）
  getSettings: () => ipcRenderer.invoke('settings-get'),
  setSettings: (patch) => ipcRenderer.send('settings-set', patch),
  onSettingsChanged: (callback) => {
    ipcRenderer.on('settings-changed', (_event, settings) => callback(settings));
  },

  // 主进程 → 渲染进程事件
  onSwitchAction: (callback) => {
    ipcRenderer.on('switch-action', (_event, actionId) => callback(actionId));
  },
  onPetCommand: (callback) => {
    ipcRenderer.on('pet-command', (_event, cmd) => callback(cmd));
  },
  onInputEvent: (callback) => {
    ipcRenderer.on('input-event', (_event, ev) => callback(ev));
  },
  // 眼神跟随：主进程 40ms 节流发来鼠标相对窗口中心的偏移
  onPointerMove: (callback) => {
    ipcRenderer.on('pointer-move', (_event, d) => callback(d));
  },
  onDisplayChanged: (callback) => {
    ipcRenderer.on('display-config-changed', (_event, d) => callback(d));
  },
  // 桌宠事件：番茄钟完成 / 系统通知等
  onPetEvent: (callback) => {
    ipcRenderer.on('pet-event', (_event, ev) => callback(ev));
  },

  // 系统
  getCapabilities: () => ipcRenderer.invoke('capabilities-get'),
  // 实时日期天气（date-weather 动作播报用；主进程拉取并缓存 10 分钟）
  getWeather: () => ipcRenderer.invoke('weather-get'),
  setOpacity: (v) => ipcRenderer.send('set-opacity', v),
  quit: () => ipcRenderer.send('quit-app'),
  openAiWindow: () => ipcRenderer.send('open-ai-window'),
  notify: (opts) => ipcRenderer.send('notify', opts || {}),

  // ---- AI 工作台 ----
  ai: {
    getSettings: () => ipcRenderer.invoke('ai-settings-get'),
    setSettings: (patch) => ipcRenderer.invoke('ai-settings-set', patch),
    listSessions: () => ipcRenderer.invoke('ai-sessions-list'),
    getSession: (id) => ipcRenderer.invoke('ai-session-get', id),
    saveSession: (session) => ipcRenderer.invoke('ai-session-save', session),
    deleteSession: (id) => ipcRenderer.invoke('ai-session-delete', id),
    getSoul: () => ipcRenderer.invoke('ai-soul-get'),
    setSoul: (content) => ipcRenderer.invoke('ai-soul-set', content),
    listSkills: () => ipcRenderer.invoke('ai-skills-list'),
    getSkill: (name) => ipcRenderer.invoke('ai-skill-get', name),
    saveAttachment: (name, mediaType, dataBase64) => ipcRenderer.invoke('ai-attachment-save', name, mediaType, dataBase64),
    runTool: (tool, action, params) => ipcRenderer.invoke('ai-tool-run', tool, action, params),
    listMemory: () => ipcRenderer.invoke('ai-memory-list'),
    addMemory: (content) => ipcRenderer.invoke('ai-memory-add', content),
    // 流式对话：sendChat 发出请求，onChatEvent 收增量事件（chunk/tool/done/error），返回取消订阅函数
    sendChat: (payload) => ipcRenderer.send('ai-chat-send', payload),
    cancelChat: (requestId) => ipcRenderer.send('ai-chat-cancel', requestId),
    onChatEvent: (callback) => {
      const handler = (_event, ev) => callback(ev);
      ipcRenderer.on('ai-chat-event', handler);
      return () => ipcRenderer.removeListener('ai-chat-event', handler);
    },
  },
});
