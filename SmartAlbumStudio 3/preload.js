const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smartAlbum', {
  chooseFiles: () => ipcRenderer.invoke('photos:choose-files'),
  chooseFolder: () => ipcRenderer.invoke('photos:choose-folder'),
  getSystemTheme: () => ipcRenderer.invoke('app:system-theme'),
  revealCache: () => ipcRenderer.invoke('app:reveal-cache'),
  onImportStarted: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('import:started', listener);
    return () => ipcRenderer.removeListener('import:started', listener);
  },
  onPhoto: (callback) => {
    const listener = (_event, photo) => callback(photo);
    ipcRenderer.on('import:photo', listener);
    return () => ipcRenderer.removeListener('import:photo', listener);
  },
  onImportProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('import:progress', listener);
    return () => ipcRenderer.removeListener('import:progress', listener);
  },
  onImportError: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('import:error', listener);
    return () => ipcRenderer.removeListener('import:error', listener);
  },
  onImportFinished: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('import:finished', listener);
    return () => ipcRenderer.removeListener('import:finished', listener);
  }
});
