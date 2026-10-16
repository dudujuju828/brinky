const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['state','connect','cancel-login','disconnect','models','usage','settings','ask','voice','flow-ready','flow-submit','flow-cancel','stop','repeat','demo','clear','show','hide','quit']);
contextBridge.exposeInMainWorld('brinky', {
  call(action, payload) {
    if (!actions.has(action)) return Promise.reject(new Error('Unknown Brinky action.'));
    return ipcRenderer.invoke('brinky:action', action, payload);
  },
  onState(callback) { const listener = (_event, state) => callback(state); ipcRenderer.on('brinky:state', listener); return () => ipcRenderer.removeListener('brinky:state', listener); },
  onCompose(callback) { const listener = () => callback(); ipcRenderer.on('brinky:compose', listener); return () => ipcRenderer.removeListener('brinky:compose', listener); },
  onPointer(callback) { const listener = (_event, pointer) => callback(pointer); ipcRenderer.on('brinky:pointer', listener); return () => ipcRenderer.removeListener('brinky:pointer', listener); },
});
