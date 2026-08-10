'use strict';

/**
 * Pico desktop shell (Electron).
 *
 * This does NOT reimplement the server, it spawns the existing server.js as a
 * child process (same code path as `npm start`, already tested) and points a
 * small native window at it. The only new logic here is onboarding: picking
 * which Claude Code project to watch, since a double-clicked desktop app has
 * no "directory you launched it from" the way the CLI version does.
 *
 * Known limitation, v1, documented rather than hidden: this assumes Node.js
 * is already installed and on PATH. Bundling a Node runtime so the app needs
 * zero prerequisites is a real fast-follow, not done here.
 */

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { autoUpdater } = require('electron-updater');

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

// One-click updates: checks the GitHub Releases feed for this repo (see the
// "publish" block in package.json) on launch. Silent if there's nothing new,
// which is the common case, only interrupts when there's an actual decision
// to make. Does nothing at all in dev mode (unpackaged), electron-updater
// requires a real packaged build to have anything to check against.
//
// Listeners registered once, module scope, not inside setupAutoUpdate() (that
// used to re-register a full set on every call, stacking duplicate dialogs
// after the first manual "Check for updates" click). lastCheckWasManual is
// how the update-not-available handler knows whether to say anything: silent
// on the automatic startup check (the common case), a real dialog when you
// actually asked.
let lastCheckWasManual = false;
autoUpdater.autoDownload = false;
autoUpdater.on('update-available', (info) => {
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `Pico ${info.version} is available (you're on ${app.getVersion()}). Download it now?`,
      buttons: ['Download', 'Not now'],
      defaultId: 0,
    })
    .then((r) => {
      if (r.response === 0) autoUpdater.downloadUpdate();
    });
});
autoUpdater.on('update-downloaded', () => {
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: 'Downloaded. Restart now to finish installing?',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
    })
    .then((r) => {
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
});
autoUpdater.on('error', (err) => console.error('[autoUpdater]', err));
autoUpdater.on('update-not-available', () => {
  // Found by audit: clicking "Check for updates" when already current did
  // nothing visible, reads as broken rather than as good news.
  if (lastCheckWasManual) {
    dialog.showMessageBox({ type: 'info', title: 'Up to date', message: `You're on the latest version (${app.getVersion()}).` });
  }
});

function setupAutoUpdate(manualCheck) {
  if (!app.isPackaged) return;
  lastCheckWasManual = !!manualCheck;
  autoUpdater.checkForUpdates().catch((err) => console.error('[autoUpdater] check failed', err));
}

const PORT = 4317;
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_PREFS = { notificationsEnabled: true, launchOnStartup: false };

let serverProcess = null;
let mainWindow = null;
let onboardingWindow = null;
let tray = null;
let notifyReq = null; // live connection to our own /events SSE feed, for native notifications
let shortcutOfferedThisRun = false;

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// App-level prefs (notifications, launch-on-startup) live in the same
// config.json as the watched project, just under their own keys, so there's
// one file, not two, to keep in sync.
function getPrefs() {
  const cfg = loadConfig() || {};
  return {
    notificationsEnabled: typeof cfg.notificationsEnabled === 'boolean' ? cfg.notificationsEnabled : DEFAULT_PREFS.notificationsEnabled,
    launchOnStartup: typeof cfg.launchOnStartup === 'boolean' ? cfg.launchOnStartup : DEFAULT_PREFS.launchOnStartup,
  };
}
function setPrefs(partial) {
  const cfg = loadConfig() || {};
  const next = Object.assign(cfg, partial);
  saveConfig(next);
  if (typeof partial.launchOnStartup === 'boolean') applyLoginItemSetting(partial.launchOnStartup);
  return getPrefs();
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

// Mirrors server.js's own encoding, kept in sync deliberately rather than
// imported, this file has to survive being bundled independently of it.
function encodeProjectDir(cwd) {
  return cwd.replace(/^([A-Za-z]):\\/, '$1--').replace(/\\/g, '-');
}

function claudeProjectsRoot() {
  const home = process.env.USERPROFILE || process.env.HOME;
  return path.join(home, '.claude', 'projects');
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
      fs.closeSync(fd);
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

// Found by external review, confirmed real: switching projects called
// startServer() again without ever stopping the previous child, leaking the
// old process (still holding the port) and risking EADDRINUSE on the new one,
// with serverProcess overwritten so the leaked one couldn't even be reached
// to clean up later. stopServer() now actually waits for exit before a new
// one starts.
function stopServer() {
  disconnectNotifyStream();
  if (!serverProcess) return Promise.resolve();
  const proc = serverProcess;
  serverProcess = null;
  return new Promise((resolve) => {
    proc.once('exit', resolve);
    proc.kill();
    setTimeout(resolve, 2000); // don't hang forever if the child won't die
  });
}

async function startServer(watchDirEncoded) {
  await stopServer();
  const projectDir = path.join(claudeProjectsRoot(), watchDirEncoded);
  const projectLabel = path.basename(realCwdFor(projectDir) || watchDirEncoded);
  serverProcess = spawn('node', [path.join(ROOT, 'server.js')], {
    // Real key ended up in a shipped release asset because the packaged app
    // wrote .env next to server.js, inside its own resources folder, by
    // default. This routes it into Electron's actual per-user data dir
    // instead, same place config.json already lives, never inside anything
    // that gets packaged/zipped/reinstalled.
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      CLAUDE_NARRATOR_DIR: projectDir,
      PICO_ENV_PATH: path.join(app.getPath('userData'), '.env'),
      PICO_PROJECT_LABEL: projectLabel,
    }),
    windowsHide: true,
  });
  connectNotifyStream();
  serverProcess.stdout.on('data', (d) => console.log(`[server] ${d}`.trim()));
  serverProcess.stderr.on('data', (d) => console.error(`[server] ${d}`.trim()));
  serverProcess.on('exit', (code) => console.log(`[server] exited with code ${code}`));
  // Found by audit: spawn() with no 'error' listener means a missing `node`
  // binary (the one documented prerequisite this app has) threw an unhandled
  // exception and took down the entire Electron main process, silently, no
  // window, no dialog. This is the single most likely first-run dead end.
  serverProcess.on('error', (err) => {
    dialog.showErrorBox(
      'Pico could not start',
      `Failed to launch the local server: ${err.message}\n\nThis usually means Node.js isn't installed or isn't on your PATH. Get it from nodejs.org, then relaunch Pico.`
    );
  });
}

// --- desktop notifications ---------------------------------------------
//
// Small and infrequent on purpose ("think Apple", per the ask): fires on
// real errors, and once when a session that was actively producing events
// goes quiet, not on every single line. Reads the server's own /events SSE
// feed rather than duplicating any transcript-tailing logic here, main.js
// just watches the same stream the browser tab does.
const sessionActivity = new Map(); // sessionId -> { count, timer }
const IDLE_NOTIFY_MS = 20000;
const IDLE_NOTIFY_MIN_EVENTS = 3;

function notify(title, body) {
  if (!getPrefs().notificationsEnabled) return;
  if (!Notification.isSupported()) return;
  // Skip if they're already looking at it, a bubble on top of the thing
  // you're already watching is just noise.
  if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) return;
  const n = new Notification({ title, body, silent: false });
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

function handleNotifyEvent(evt) {
  if (evt.kind === 'system') return;
  if (evt.kind === 'error') {
    notify('Pico', evt.detail || evt.label || 'Something went wrong in a session.');
    return;
  }
  const sid = evt.sessionId;
  if (!sid) return;
  let entry = sessionActivity.get(sid);
  if (!entry) {
    entry = { count: 0, timer: null };
    sessionActivity.set(sid, entry);
  }
  entry.count += 1;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    if (entry.count >= IDLE_NOTIFY_MIN_EVENTS) {
      notify('Pico', 'Claude looks done for now, quiet for a bit after some activity.');
    }
    sessionActivity.delete(sid);
  }, IDLE_NOTIFY_MS);
}

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
          handleNotifyEvent(JSON.parse(raw.slice(6)));
        } catch {
          // partial/malformed frame, ignore
        }
      }
    });
  });
  req.on('error', () => {
    if (attemptsLeft > 0 && serverProcess) setTimeout(() => connectNotifyStream(attemptsLeft - 1), 300);
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
  sessionActivity.forEach((entry) => entry.timer && clearTimeout(entry.timer));
  sessionActivity.clear();
}

let isQuitting = false;

function openMainWindow() {
  mainWindow = new BrowserWindow({
    width: 780,
    height: 640,
    minWidth: 420,
    minHeight: 400,
    backgroundColor: '#0a0a0c',
    title: 'Pico',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      spellcheck: true,
      autoplayPolicy: 'no-user-gesture-required',
      preload: path.join(__dirname, 'preload-main.js'),
    },
  });
  mainWindow.setMenuBarVisibility(false);
  // Closing the window hides it, doesn't quit, that's the whole point of the
  // tray icon: this keeps narrating in the background until you actually quit.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  // Server takes a moment to bind, retry the load rather than race it.
  const tryLoad = (attemptsLeft) => {
    mainWindow.loadURL(`http://localhost:${PORT}`).catch(() => {
      if (attemptsLeft > 0) setTimeout(() => tryLoad(attemptsLeft - 1), 300);
    });
  };
  tryLoad(15);
}

function openOnboardingWindow() {
  onboardingWindow = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: false,
    backgroundColor: '#0a0a0c',
    title: 'Pico setup',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  onboardingWindow.setMenuBarVisibility(false);
  onboardingWindow.loadFile(path.join(__dirname, 'onboarding.html'));
}

ipcMain.handle('list-projects', () => listAvailableProjects());
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(onboardingWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  return { encoded: encodeProjectDir(result.filePaths[0]), path: result.filePaths[0], lastActive: Date.now() };
});
ipcMain.handle('confirm-project', async (event, encoded) => {
  // Merge, don't replace: this used to overwrite the whole config file with
  // just { watchDirEncoded }, silently dropping notificationsEnabled and
  // launchOnStartup back to defaults every time a project was switched.
  saveConfig(Object.assign({}, loadConfig(), { watchDirEncoded: encoded }));
  if (onboardingWindow) {
    onboardingWindow.close();
    onboardingWindow = null;
  }
  await startServer(encoded);
  openMainWindow();
  offerDesktopShortcut();
});

ipcMain.handle('get-app-prefs', () => getPrefs());
ipcMain.handle('set-app-prefs', (event, partial) => setPrefs(partial || {}));

// --- desktop shortcut ----------------------------------------------------
//
// electron-packager (used here because electron-builder's NSIS step can't
// run in this build environment, see README) produces a plain folder, no
// installer, so nothing puts an icon on the Desktop the way a real installer
// would. This does it directly via PowerShell's WScript.Shell COM object,
// the same mechanism Windows shortcuts (.lnk) are made with, no extra tools.
function desktopShortcutPath() {
  const desktop = path.join(app.getPath('home'), 'Desktop');
  return path.join(desktop, 'Pico.lnk');
}
function createDesktopShortcut() {
  if (!app.isPackaged) return Promise.resolve(false); // dev mode: nothing sane to point a shortcut at
  const target = process.execPath; // Pico.exe itself, icon is already embedded at package time
  const linkPath = desktopShortcutPath();
  const psCommand =
    `$s = New-Object -ComObject WScript.Shell; ` +
    `$lnk = $s.CreateShortcut('${linkPath.replace(/'/g, "''")}'); ` +
    `$lnk.TargetPath = '${target.replace(/'/g, "''")}'; ` +
    `$lnk.WorkingDirectory = '${path.dirname(target).replace(/'/g, "''")}'; ` +
    `$lnk.Save()`;
  return new Promise((resolve) => {
    exec(`powershell -NoProfile -NonInteractive -Command "${psCommand}"`, (err) => {
      if (err) console.error('[shortcut] failed', err);
      resolve(!err);
    });
  });
}
// Offered once per run, only the first time this machine ever finishes
// onboarding (tracked in config.json), and only if nothing's already there,
// re-clicking "Change watched project" on every later run shouldn't nag.
function offerDesktopShortcut() {
  if (shortcutOfferedThisRun) return;
  shortcutOfferedThisRun = true;
  if (!app.isPackaged) return;
  const cfg = loadConfig() || {};
  if (cfg.desktopShortcutOffered) return;
  if (fs.existsSync(desktopShortcutPath())) {
    saveConfig(Object.assign({}, cfg, { desktopShortcutOffered: true }));
    return;
  }
  createDesktopShortcut().then((ok) => {
    saveConfig(Object.assign({}, loadConfig(), { desktopShortcutOffered: true }));
    if (ok) notify('Pico', 'Added a Pico shortcut to your Desktop.');
  });
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
  } catch {
    return; // icon missing or platform quirk, tray is a nice-to-have, not load-bearing
  }
  tray.setToolTip('Pico');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show', click: () => (mainWindow ? mainWindow.show() : openMainWindow()) },
      { label: 'Change watched project…', click: () => { if (mainWindow) mainWindow.hide(); openOnboardingWindow(); } },
      { label: 'Create desktop shortcut', click: () => createDesktopShortcut() },
      { label: 'Check for updates…', click: () => setupAutoUpdate(true) },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ])
  );
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
  createTray();
  applyLoginItemSetting(getPrefs().launchOnStartup);
  const config = loadConfig();
  if (config && config.watchDirEncoded) {
    await startServer(config.watchDirEncoded);
    openMainWindow();
    offerDesktopShortcut();
  } else {
    openOnboardingWindow();
  }
  setupAutoUpdate();
});

// Deliberately no window-all-closed handler. The main window hides instead of
// closing (see the 'close' listener above), and if it's the onboarding
// window that closes without a tray, that's a genuinely broken state (no
// icon.png yet, see the icon TODO), not one to silently paper over by quitting.

app.on('before-quit', () => {
  isQuitting = true;
  if (serverProcess) serverProcess.kill();
});
