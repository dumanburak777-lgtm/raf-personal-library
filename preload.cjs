const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rafDesktop', Object.freeze({
  register: input => ipcRenderer.invoke('raf:register', input),
  login: input => ipcRenderer.invoke('raf:login', input),
  googleLogin: input => ipcRenderer.invoke('raf:google-login', input),
  googleUnlock: input => ipcRenderer.invoke('raf:google-unlock', input),
  session: () => ipcRenderer.invoke('raf:session'),
  logout: () => ipcRenderer.invoke('raf:logout'),
  readLibrary: () => ipcRenderer.invoke('raf:read-library'),
  writeLibrary: items => ipcRenderer.invoke('raf:write-library', items),
  exportLibrary: () => ipcRenderer.invoke('raf:export-library'),
  importLibrary: () => ipcRenderer.invoke('raf:import-library'),
  discourseConnect: input => ipcRenderer.invoke('raf:discourse-connect', input),
  discourseStatus: () => ipcRenderer.invoke('raf:discourse-status'),
  discourseRooms: () => ipcRenderer.invoke('raf:discourse-rooms'),
  discourseRoom: id => ipcRenderer.invoke('raf:discourse-room', id),
  discourseCreateRoom: input => ipcRenderer.invoke('raf:discourse-create-room', input),
  discourseReply: input => ipcRenderer.invoke('raf:discourse-reply', input),
  discourseDisconnect: () => ipcRenderer.invoke('raf:discourse-disconnect')
}));
