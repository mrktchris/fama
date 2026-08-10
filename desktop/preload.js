'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit surface, the onboarding page never gets raw Node/fs
// access, only these three calls.
contextBridge.exposeInMainWorld('famaSetup', {
  listProjects: () => ipcRenderer.invoke('list-projects'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  getCurrentProjects: () => ipcRenderer.invoke('get-current-projects'),
  confirmProjects: (encodedList) => ipcRenderer.invoke('confirm-projects', encodedList),
});
