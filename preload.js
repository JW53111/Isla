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
  onDisplayChanged: (callback) => {
    ipcRenderer.on('display-config-changed', (_event, d) => callback(d));
  },

  // 系统
  getCapabilities: () => ipcRenderer.invoke('capabilities-get'),
  setOpacity: (v) => ipcRenderer.send('set-opacity', v),
  quit: () => ipcRenderer.send('quit-app'),
});
