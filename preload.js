const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  setFullscreen: (flag) => ipcRenderer.send('window:setFullscreen', flag),
  getServerPort: () => ipcRenderer.invoke('settings:getPort')
});
