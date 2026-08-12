'use strict';

/**
 * Fama desktop shell (Electron).
 *
 * This does NOT reimplement the server, it spawns the existing server.js as a
 * child process (same code path as `npm start`, already tested) and points a
 * small native window at it. The only new logic here is onboarding: picking
 * which coding project to watch, since a double-clicked desktop app has
 * no "directory you launched it from" the way the CLI version does.
 *
 * The child server runs through Electron's bundled Node runtime, so packaged
 * users do not need a separate Node.js install or a trustworthy PATH entry.
 */

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification, shell, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');
const { LocalServerRuntime } = require('./local-server');
const { DesktopNotifications } = require('./desktop-notifications');
const { RuntimeConfigStore } = require('./runtime-config');
const { createWindowPolicy, isLocalAppUrl } = require('./window-policy');
const { UpdateRuntime } = require('./update-runtime');
const { desktopPlatformInfo } = require('./platform');

const platformInfo = desktopPlatformInfo();

// Found by audit: with no single-instance lock, double-clicking the exe again
// (very plausible, since closing the window hides it instead of quitting, and
// a first-time user has no way to know that) spawns a second server that
// dies uncaught on EADDRINUSE while its window quietly loads against the
// FIRST instance's still-live server, two processes/tray icons pretending
// to be one app, and quitting the wrong one kills the real one.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Found live: notification bubbles showed "electron.app.Fama" as their
// source, not "Fama", because Windows shows Electron's default AppUserModelID
// unless one is set explicitly. Matches package.json's build.appId.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.chrissierra.fama');
}

const updateRuntime = new UpdateRuntime({ updater: autoUpdater, dialog, shell, app });

function setupAutoUpdate(manualCheck) {
  const updateMetadata = path.join(process.resourcesPath, 'app-update.yml');
  const available = app.isPackaged && fs.existsSync(updateMetadata);
  return updateRuntime.check({ manual: Boolean(manualCheck), available });
}

const PORT = 4317;
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

// Rename continuity: app.getPath('userData') is derived from productName
// (see package.json), so renaming Pico -> Fama moves every existing user's
// config.json AND .env (their real OpenAI key) to a brand new folder the app
// has never looked in, which reads as "it forgot everything" on update. This
// runs once, synchronously, before anything else touches CONFIG_PATH: if the
// new folder has no config yet but the old Pico folder does, copy config.json
// and .env across (never delete the old copy, this is a copy not a move, in
// case something goes wrong reading it back).
function migrateFromPreviousName() {
  if (fs.existsSync(CONFIG_PATH)) return; // already has its own config, nothing to migrate
  const oldUserData = path.join(path.dirname(app.getPath('userData')), 'Pico');
  const oldConfig = path.join(oldUserData, 'config.json');
  if (!fs.existsSync(oldConfig)) return; // no prior Pico install on this machine
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.copyFileSync(oldConfig, CONFIG_PATH);
    const oldEnv = path.join(oldUserData, '.env');
    if (fs.existsSync(oldEnv)) {
      const newEnv = path.join(app.getPath('userData'), '.env');
      fs.copyFileSync(oldEnv, newEnv); // copyFileSync reproduces the source file's mode, so...
      try {
        fs.chmodSync(newEnv, 0o600); // ...re-tighten it here rather than carry forward whatever the old one had
      } catch {
        // not supported on Windows, fine
      }
    }
    const oldUsage = path.join(oldUserData, 'usage.json');
    if (fs.existsSync(oldUsage)) fs.copyFileSync(oldUsage, path.join(app.getPath('userData'), 'usage.json'));
    // Deliberately NOT carried over: desktopShortcutOffered. The old Desktop
    // shortcut (if one exists) points at "Pico.lnk" and the old exe path,
    // both wrong now, so this rename gets exactly one fresh offer under the
    // new name instead of silently keeping a stale/broken shortcut forever.
    const migrated = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    delete migrated.desktopShortcutOffered;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(migrated, null, 2), 'utf8');
    console.log('[migrate] carried over config/.env/usage from the previous Pico install');
  } catch (err) {
    console.error('[migrate] failed to carry over previous config', err);
  }
}
migrateFromPreviousName();

const runtimeConfig = new RuntimeConfigStore(CONFIG_PATH);
const { assertIpcSender, hardenWindowNavigation } = createWindowPolicy({ shell });
let mainWindow = null;
let onboardingWindow = null;
let tray = null;
let notifyReq = null; // live connection to our own /events SSE feed, for native notifications
let shortcutOfferedThisRun = false;

// App-level prefs (notifications, launch-on-startup) live in the same
// config.json as the watched project, just under their own keys, so there's
// one file, not two, to keep in sync.
function getPrefs() {
  return runtimeConfig.prefs();
}
// Only these two keys, and only as booleans: this is reachable from the
// renderer over IPC (see the set-app-prefs handler below), and an unfiltered
// Object.assign of the whole request body would let that call also rewrite
// selectedProjects or any other config field, not just the two prefs this
// bridge is meant to expose. Not exploitable today (the only real caller is
// this app's own Settings panel), but the IPC itself should not trust its
// caller further than its own contract, found by security audit.
function setPrefs(partial) {
  const prefs = runtimeConfig.setPrefs(partial);
  if (typeof partial.launchOnStartup === 'boolean') applyLoginItemSetting(partial.launchOnStartup);
  return prefs;
}
function applyLoginItemSetting(openAtLogin) {
  // No-op in dev (unpackaged): setLoginItemSettings would point Windows at
  // electron.exe with dev args, not something a user should get auto-started.
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin });
  } catch (err) {
    console.error('[prefs] failed to set login item', err);
  }
}

// Was two hand-copied implementations (this file and server.js each had
// their own), real drift risk with zero tests to catch it, now one shared,
// tested module. Both files ship together in every build regardless
// (electron-packager copies the whole project), so nothing was ever gained
// by keeping them independent.
const { encodeProjectDir, claudeProjectsRoot, projectDirFromEncoded } = require(path.join(ROOT, 'lib', 'paths'));
const {
  selectedProjectsFromEncoded,
  selectedProjectsFromSelection,
  validEncodedProjects: validateEncodedProjects,
} = require(path.join(ROOT, 'lib', 'selected-projects'));

function validEncodedProjects(value) {
  return validateEncodedProjects(value, projectDirFromEncoded);
}

// Reads a project folder's real path from inside its own transcript data
// (the "cwd" field every record already carries) rather than trying to
// reverse the folder-name encoding, which is lossy if the real path itself
// contains hyphens, most paths do.
//
// Bug fixed here after seeing it live: the first line of a session file is
// often bookkeeping ("queue-operation" etc.) with no cwd field at all, the
// real user record with cwd usually shows up a few lines in. Checking only
// line[0] meant this fell back to the raw encoded folder name for every
// single project, which is exactly what shipped and got caught. Now it scans
// every line in a larger chunk, and tries the most recently touched session
// file first since that's the one most likely to matter anyway.
function realCwdFor(projectDir) {
  let entries;
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const jsonlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .map((e) => {
      const full = path.join(projectDir, e.name);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        // leave mtime at 0, this file just sorts last
      }
      return { full, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of jsonlFiles) {
    let fd;
    try {
      fd = fs.openSync(file.full, 'r');
      const buf = Buffer.alloc(16384); // room for several bookkeeping lines before the first real record
      const bytesRead = fs.readSync(fd, buf, 0, 16384, 0);
      const lines = buf.toString('utf8', 0, bytesRead).split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const record = JSON.parse(trimmed);
          if (record && typeof record.cwd === 'string' && record.cwd) return record.cwd;
        } catch {
          continue; // partial line (chunk cutoff) or non-JSON bookkeeping, keep scanning
        }
      }
    } catch {
      continue;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // File disappeared between discovery and read; try another one.
        }
      }
    }
  }
  return null;
}

function listAvailableProjects() {
  const root = claudeProjectsRoot();
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(root, entry.name);
    let mtime = 0;
    try {
      const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
      for (const f of files) {
        const stat = fs.statSync(path.join(projectDir, f));
        if (stat.mtimeMs > mtime) mtime = stat.mtimeMs;
      }
    } catch {
      continue;
    }
    if (!mtime) continue;
    const realCwd = realCwdFor(projectDir) || entry.name;
    projects.push({ encoded: entry.name, path: realCwd, lastActive: mtime });
  }
  projects.sort((a, b) => b.lastActive - a.lastActive);
  return projects;
}

const localServer = new LocalServerRuntime({
  spawn,
  executable: process.execPath,
  serverPath: path.join(ROOT, 'server.js'),
  port: PORT,
  userDataPath: app.getPath('userData'),
  onStarted: () => connectNotifyStream(),
  onStopping: () => disconnectNotifyStream(),
  onError: (error) => {
    dialog.showErrorBox(
      'Fama could not start',
      `Failed to launch the bundled local server: ${error.message}\n\nRestart Fama. If this persists, reinstall the latest release.`
    );
  },
});

async function startServer(watchDirsEncoded) {
  const projects =
    Array.isArray(watchDirsEncoded) && watchDirsEncoded.length && watchDirsEncoded[0] && watchDirsEncoded[0].dir
      ? watchDirsEncoded
      : selectedProjectsFromEncoded(watchDirsEncoded, { projectDirFromEncoded, realCwdFor, encodeProjectDir });
  if (!projects.length) throw new Error('No valid project directories were selected.');
  await localServer.start(projects);
  return projects;
}

// --- desktop notifications ---------------------------------------------
//
// Small and infrequent on purpose ("think Apple", per the ask): fires on
// real errors, and once when a session that was actively producing events
// goes quiet, not on every single line. Reads the server's own /events SSE
// feed rather than duplicating any transcript-tailing logic here, main.js
// just watches the same stream the browser tab does.
// Found live: 20s of quiet after only 3 events fires constantly during
// completely normal use, Claude Code sessions have pauses well over 20s
// between tool calls all the time. Raised to a threshold that means
// something (a real burst, then genuinely done for a while), plus a global
// cooldown so several lanes going idle around the same time do not stack
// bubbles back to back. Desktop Notifications owns that policy and its timers.

function notify(title, body) {
  if (!getPrefs().notificationsEnabled) return;
  if (!Notification.isSupported()) return;
  // Skip if they're already looking at it, a bubble on top of the thing
  // you're already watching is just noise.
  if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) return;
  // No icon meant Windows fell back to a generic/default one, the bubble
  // didn't read as coming from this app at a glance. A hard cap on body
  // length matters here too: this gets fed raw tool-error text sometimes,
  // and an unbounded string turns a small clean bubble into a wall of text.
  const n = new Notification({
    title,
    body: body && body.length > 180 ? body.slice(0, 177) + '…' : body,
    icon: path.join(__dirname, 'icon.png'),
    silent: false,
  });
  n.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      openMainWindow();
    }
  });
  n.show();
}

const desktopNotifications = new DesktopNotifications({ deliver: notify });

// Plain http.get against our own loopback server, not a browser EventSource,
// this runs in the main process which has no DOM. Retries a few times while
// the child process is still binding, same pattern as openMainWindow's
// tryLoad, then gives up quietly, notifications are a nice-to-have, not
// load-bearing.
function connectNotifyStream(attemptsLeft) {
  if (attemptsLeft === undefined) attemptsLeft = 15;
  disconnectNotifyStream();
  const req = http.get(`http://127.0.0.1:${PORT}/events`, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!raw.startsWith('data: ')) continue;
        try {
          desktopNotifications.handle(JSON.parse(raw.slice(6)));
        } catch {
          // partial/malformed frame, ignore
        }
      }
    });
  });
  req.on('error', () => {
    if (attemptsLeft > 0 && localServer.isRunning()) setTimeout(() => connectNotifyStream(attemptsLeft - 1), 300);
  });
  notifyReq = req;
}
function disconnectNotifyStream() {
  if (notifyReq) {
    try {
      notifyReq.destroy();
    } catch {
      // already dead, fine
    }
    notifyReq = null;
  }
  desktopNotifications.reset();
}

let isQuitting = false;

function loadMainApp(window, attemptsLeft = 15) {
  window.loadURL(`http://localhost:${PORT}`).catch(() => {
    if (attemptsLeft > 0 && !window.isDestroyed()) setTimeout(() => loadMainApp(window, attemptsLeft - 1), 300);
  });
}

function openMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    loadMainApp(mainWindow);
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 780,
    height: 640,
    minWidth: 420,
    minHeight: 400,
    backgroundColor: '#080b12',
    title: 'Fama',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: true,
      autoplayPolicy: 'no-user-gesture-required',
      preload: path.join(__dirname, 'preload-main.js'),
    },
  });
  if (process.platform !== 'darwin') mainWindow.setMenuBarVisibility(false);
  hardenWindowNavigation(mainWindow, (url) => isLocalAppUrl(url, PORT));
  // Closing the window hides it, doesn't quit, that's the whole point of the
  // tray icon: this keeps narrating in the background until you actually quit.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  // Server takes a moment to bind, retry the load rather than race it.
  loadMainApp(mainWindow);
}

function openOnboardingWindow() {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.show();
    onboardingWindow.focus();
    return;
  }
  onboardingWindow = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: false,
    backgroundColor: '#080b12',
    title: 'Fama setup',
    icon: path.join(__dirname, 'icon.png'), // found live: this window had no icon set, fell back to Electron's default
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  if (process.platform !== 'darwin') onboardingWindow.setMenuBarVisibility(false);
  const onboardingPath = path.join(__dirname, 'onboarding.html');
  const onboardingUrl = pathToFileURL(onboardingPath).href;
  hardenWindowNavigation(onboardingWindow, (url) => url === onboardingUrl);
  onboardingWindow.loadFile(onboardingPath);
}

ipcMain.handle('list-projects', (event) => {
  assertIpcSender(event, onboardingWindow);
  return listAvailableProjects();
});
ipcMain.handle('pick-folder', async (event) => {
  assertIpcSender(event, onboardingWindow);
  const result = await dialog.showOpenDialog(onboardingWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  return { encoded: encodeProjectDir(result.filePaths[0]), path: result.filePaths[0], lastActive: Date.now() };
});
// Migrated from a single confirmed project to a list: one server can now
// watch several at once. currentProjects() lets the onboarding window
// pre-check whatever's already selected when reopened as "manage" rather
// than first-run setup.
function currentProjects() {
  return runtimeConfig.encodedSelection(projectDirFromEncoded);
}
ipcMain.handle('get-current-projects', (event) => {
  assertIpcSender(event, onboardingWindow);
  return currentProjects();
});
ipcMain.handle('confirm-projects', async (event, selection) => {
  assertIpcSender(event, onboardingWindow);
  if (selection && selection.clear === true) {
    runtimeConfig.clearSelectedProjects();
    await localServer.stop();
    if (onboardingWindow) {
      onboardingWindow.close();
      onboardingWindow = null;
    }
    if (mainWindow) mainWindow.hide();
    return true;
  }
  const projects = selectedProjectsFromSelection(selection, { projectDirFromEncoded, realCwdFor, encodeProjectDir });
  if (!projects.length) return false; // nothing selected, caller should keep the window open
  runtimeConfig.setSelectedProjects(projects);
  if (onboardingWindow) {
    onboardingWindow.close();
    onboardingWindow = null;
  }
  await startServer(projects);
  openMainWindow();
  offerDesktopShortcut();
  return true;
});

ipcMain.handle('get-app-prefs', (event) => {
  assertIpcSender(event, mainWindow);
  return getPrefs();
});
ipcMain.handle('get-platform-info', (event) => {
  assertIpcSender(event, mainWindow);
  return platformInfo;
});
ipcMain.handle('set-app-prefs', (event, partial) => {
  assertIpcSender(event, mainWindow);
  return setPrefs(partial || {});
});

// Same flow as the tray's "Manage watched projects…" item, just reachable
// from inside the main window instead of only the tray, which nobody
// reliably discovers on their own.
ipcMain.handle('open-manage-projects', (event) => {
  assertIpcSender(event, mainWindow);
  if (mainWindow) mainWindow.hide();
  openOnboardingWindow();
});

// --- desktop shortcut ----------------------------------------------------
//
// electron-packager (used here because electron-builder's NSIS step can't
// run in this build environment, see README) produces a plain folder, no
// installer, so nothing puts an icon on the Desktop the way a real installer
// would. Electron's native shortcut API creates it without invoking a shell.
function desktopShortcutPath() {
  return path.join(app.getPath('desktop'), 'Fama.lnk');
}
function createDesktopShortcut() {
  if (!app.isPackaged || process.platform !== 'win32') return Promise.resolve(false);
  const target = process.execPath; // Fama.exe itself, icon is already embedded at package time
  const linkPath = desktopShortcutPath();
  try {
    return Promise.resolve(
      shell.writeShortcutLink(linkPath, 'replace', {
        target,
        cwd: path.dirname(target),
        description: 'Open Fama',
      })
    );
  } catch (err) {
    console.error('[shortcut] failed', err);
    return Promise.resolve(false);
  }
}
// Offered once per run, only the first time this machine ever finishes
// onboarding (tracked in config.json), and only if nothing's already there,
// re-clicking "Change watched project" on every later run shouldn't nag.
function offerDesktopShortcut() {
  if (!platformInfo.supportsDesktopShortcut) return;
  if (shortcutOfferedThisRun) return;
  shortcutOfferedThisRun = true;
  if (!app.isPackaged) return;
  const cfg = runtimeConfig.load();
  if (cfg.desktopShortcutOffered) return;
  if (fs.existsSync(desktopShortcutPath())) {
    runtimeConfig.update({ desktopShortcutOffered: true });
    return;
  }
  createDesktopShortcut().then((ok) => {
    if (ok) {
      runtimeConfig.update({ desktopShortcutOffered: true });
      notify('Fama', 'Added a Fama shortcut to your Desktop.');
    }
  });
}

function createTray() {
  let trayIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  if (process.platform === 'darwin' && !trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 18, height: 18 });
    trayIcon.setTemplateImage(true);
  }
  try {
    tray = new Tray(trayIcon);
  } catch {
    return; // icon missing or platform quirk, tray is a nice-to-have, not load-bearing
  }
  tray.setToolTip('Fama');
  const trayTemplate = [
      { label: 'Show', click: () => (mainWindow ? mainWindow.show() : openMainWindow()) },
      { label: 'Manage watched projects…', click: () => { if (mainWindow) mainWindow.hide(); openOnboardingWindow(); } },
      platformInfo.supportsDesktopShortcut ? { label: 'Create desktop shortcut', click: () => createDesktopShortcut() } : null,
      { label: 'Check for updates…', click: () => setupAutoUpdate(true) },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ].filter(Boolean);
  tray.setContextMenu(Menu.buildFromTemplate(trayTemplate));
}

function showOrCreatePrimaryWindow() {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.show();
    onboardingWindow.focus();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  openMainWindow();
}

function createNativeApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  app.setAboutPanelOptions({
    applicationName: 'Fama',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Copyright © 2026 Christian Sierra',
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Fama',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Check for Updates…', click: () => setupAutoUpdate(true) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Show Fama', accelerator: 'Command+0', click: showOrCreatePrimaryWindow },
        { label: 'Manage Watched Projects…', accelerator: 'Command+,', click: () => { if (mainWindow) mainWindow.hide(); openOnboardingWindow(); } },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
  if (app.dock) {
    app.dock.setMenu(Menu.buildFromTemplate([
      { label: 'Show Fama', click: showOrCreatePrimaryWindow },
      { label: 'Manage Watched Projects…', click: () => { if (mainWindow) mainWindow.hide(); openOnboardingWindow(); } },
    ]));
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    openMainWindow();
  }
});

app.whenReady().then(async () => {
  createNativeApplicationMenu();
  createTray();
  applyLoginItemSetting(getPrefs().launchOnStartup);
  // Preserve the canonical working directory for browsed folders: Codex
  // discovery matches session metadata against cwd, while the older Claude
  // selection shapes only carried an encoded transcript-directory name.
  // RuntimeConfigStore validates canonical entries and migrates legacy ones.
  const initialProjects = runtimeConfig.runtimeProjects({ projectDirFromEncoded, realCwdFor, encodeProjectDir });
  if (initialProjects.length) {
    await startServer(initialProjects);
    openMainWindow();
    offerDesktopShortcut();
  } else {
    openOnboardingWindow();
  }
  setupAutoUpdate();
});

app.on('activate', showOrCreatePrimaryWindow);

// Deliberately no window-all-closed handler. The main window hides instead of
// closing (see the 'close' listener above), and if the onboarding window
// closes without a tray, that is a genuinely broken state rather than one to
// silently paper over by quitting.

app.on('before-quit', () => {
  isQuitting = true;
  localServer.terminate();
});
