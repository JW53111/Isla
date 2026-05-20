const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  showContextMenu: (currentActionId) => ipcRenderer.send('show-context-menu', currentActionId),
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', width, height),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
  onSwitchAction: (callback) => {
    ipcRenderer.on('switch-action', (_event, actionId) => callback(actionId));
  },
});
