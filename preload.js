const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  setFullscreen: (flag) => ipcRenderer.send('window:setFullscreen', flag),
  getServerPort: () => ipcRenderer.invoke('settings:getPort'),
  
  // Projector Window APIs
  openProjector: () => ipcRenderer.send('projector:open'),
  closeProjector: () => ipcRenderer.send('projector:close'),
  getProjectorStatus: () => ipcRenderer.invoke('projector:status'),
  setProjectorFullscreen: (flag) => ipcRenderer.send('projector:setFullscreen', flag),
  
  // IPC cross-window forwarding
  sendToProjector: (channel, data) => ipcRenderer.send('to:projector', channel, data),
  sendToControl: (channel, data) => ipcRenderer.send('to:control', channel, data),
  onProjectorMessage: (channel, callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
  onControlMessage: (channel, callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  }
});
