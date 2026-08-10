'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit surface, the onboarding page never gets raw Node/fs
// access, only these three calls.
contextBridge.exposeInMainWorld('narratorSetup', {
  listProjects: () => ipcRenderer.invoke('list-projects'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  confirmProject: (encoded) => ipcRenderer.invoke('confirm-project', encoded),
});
