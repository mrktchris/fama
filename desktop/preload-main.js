'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit surface for the main app window. This only exists so the
// web Settings panel can offer two Electron-only controls (desktop
// notifications, launch at startup) that are meaningless when this same
// server.js/viewer is run plain via `npm start` outside Electron. The web
// code checks for window.famaDesktop before showing that section at all.
contextBridge.exposeInMainWorld('famaDesktop', {
  getPrefs: () => ipcRenderer.invoke('get-app-prefs'),
  setPrefs: (partial) => ipcRenderer.invoke('set-app-prefs', partial),
});
