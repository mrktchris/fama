'use strict';

/**
 * Fama desktop shell (Electron).
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

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification, shell } = require('electron');
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

// Found live: notification bubbles showed "electron.app.Fama" as their
// source, not "Fama", because Windows shows Electron's default AppUserModelID
// unless one is set explicitly. Matches package.json's build.appId.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.chrissierra.fama');
}

// Update NOTIFICATION, not one-click auto-install, despite the name of the
// library: checks the GitHub Releases feed for this repo (see the "publish"
// block in package.json) on launch, silent if there's nothing new. Real bug
// found by reviewing this project's own test logs (not by inspection): the
// original design here called autoUpdater.downloadUpdate() /
// autoUpdater.quitAndInstall(), which is electron-updater's NSIS-installer
// update flow. This app ships as an unpacked electron-packager folder (see
// the README section on why NSIS can't run in this build environment), not
// an NSIS install, so that flow was never actually going to work end to end,
// on top of which every check was failing outright on a missing
// app-update.yml (electron-builder writes that automatically; electron-
// packager has no idea electron-updater exists) and then, once that part was
// fixed, on a missing latest.yml release asset (also an electron-builder
// output, now hand-generated and uploaded alongside every release zip, see
// desktop/write-update-manifest.js and the release step in README/CHANGELOG).
// Detecting "a newer version exists" now genuinely works; opening this
// app's own Releases page to grab it is the honest equivalent of one-click
// for a distribution method that has no installer to auto-run.
//
// Listeners registered once, module scope, not inside setupAutoUpdate() (that
// used to re-register a full set on every call, stacking duplicate dialogs
// after the first manual "Check for updates" click). lastCheckWasManual is
// how the update-not-available/error handlers know whether to say anything:
// silent on the automatic startup check (the common case), a real dialog
// when you actually asked.
let lastCheckWasManual = false;
autoUpdater.autoDownload = false;
autoUpdater.on('update-available', (info) => {
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `Fama ${info.version} is available (you're on ${app.getVersion()}).`,
      buttons: ['Open Releases page', 'Not now'],
      defaultId: 0,
    })
    .then((r) => {
      if (r.response === 0) shell.openExternal('https://github.com/mrktchris/fama/releases/latest');
    });
});
autoUpdater.on('error', (err) => {
  console.error('[autoUpdater]', err);
  if (lastCheckWasManual) {
    dialog.showMessageBox({
      type: 'error',
      title: 'Could not check for updates',
      message: `${err.message}\n\nYou can always check manually at the Releases page.`,
    });
  }
});
autoUpdater.on('update-not-available', () => {
  // Found by audit: clicking "Check for updates" when already current did
  // nothing visible, reads as broken rather than as good news.
  if (lastCheckWasManual) {
    dialog.showMessageBox({ type: 'info', title: 'Up to date', message: `You're on the latest version (${app.getVersion()}).` });
  }
});

function setupAutoUpdate(manualCheck) {
  if (!app.isPackaged) {
    // Found live: clicking "Check for updates" in dev mode did nothing at
    // all, no dialog, no console hint, reads as a broken button. It IS a
    // no-op by design (electron-updater has nothing to check against outside
    // a packaged build), but a manual click deserves to be told that instead
    // of just... not responding.
    if (manualCheck) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Not available in dev mode',
        message: "Update checks only work in a packaged build, there's nothing for electron-updater to check against here.",
      });
    }
    return;
  }
  lastCheckWasManual = !!manualCheck;
  autoUpdater.checkForUpdates().catch((err) => {
    // Found live: checkForUpdates() rejecting (as opposed to the autoUpdater
    // emitting its own 'error' event, handled above) was only ever logged to
    // console, invisible in a packaged app with no console window attached.
    // A manual click that hits this path looked exactly like a dead button.
    console.error('[autoUpdater] check failed', err);
    if (lastCheckWasManual) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Could not check for updates',
        message: `${err && err.message ? err.message : String(err)}\n\nYou can always check manually at the Releases page.`,
      });
    }
  });
}

const PORT = 4317;
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_PREFS = { notificationsEnabled: true, launchOnStartup: false };

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
// Only these two keys, and only as booleans: this is reachable from the
// renderer over IPC (see the set-app-prefs handler below), and an unfiltered
// Object.assign of the whole request body would let that call also rewrite
// watchDirsEncoded or any other config field, not just the two prefs this
// bridge is meant to expose. Not exploitable today (the only real caller is
// this app's own Settings panel), but the IPC itself should not trust its
// caller further than its own contract, found by security audit.
const SETTABLE_PREF_KEYS = ['notificationsEnabled', 'launchOnStartup'];
function setPrefs(partial) {
  const cfg = loadConfig() || {};
  for (const key of SETTABLE_PREF_KEYS) {
    if (typeof partial[key] === 'boolean') cfg[key] = partial[key];
  }
  saveConfig(cfg);
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

// Was two hand-copied implementations (this file and server.js each had
// their own), real drift risk with zero tests to catch it, now one shared,
// tested module. Both files ship together in every build regardless
// (electron-packager copies the whole project), so nothing was ever gained
// by keeping them independent.
const { encodeProjectDir, claudeProjectsRoot } = require(path.join(ROOT, 'lib', 'paths'));

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

async function startServer(watchDirsEncoded) {
  await stopServer();
  // Accept a single encoded dir too (older config, or a direct call), always
  // work internally as a list, one server can now watch several projects.
  const encodedList = Array.isArray(watchDirsEncoded) ? watchDirsEncoded : [watchDirsEncoded];
  const projectDirs = encodedList.map((encoded) => path.join(claudeProjectsRoot(), encoded));
  const projectLabels = projectDirs.map((dir, i) => path.basename(realCwdFor(dir) || encodedList[i]));
  serverProcess = spawn('node', [path.join(ROOT, 'server.js')], {
    // Real key ended up in a shipped release asset because the packaged app
    // wrote .env next to server.js, inside its own resources folder, by
    // default. This routes it into Electron's actual per-user data dir
    // instead, same place config.json already lives, never inside anything
    // that gets packaged/zipped/reinstalled.
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      FAMA_ENV_PATH: path.join(app.getPath('userData'), '.env'),
      FAMA_USAGE_PATH: path.join(app.getPath('userData'), 'usage.json'),
      CLAUDE_NARRATOR_DIRS: JSON.stringify(projectDirs),
      FAMA_PROJECT_LABELS: JSON.stringify(projectLabels),
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
      'Fama could not start',
      `Failed to launch the local server: ${err.message}\n\nThis usually means Node.js isn't installed or isn't on your PATH. Get it from nodejs.org, then relaunch Fama.`
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
// Found live: 20s of quiet after only 3 events fires constantly during
// completely normal use, Claude Code sessions have pauses well over 20s
// between tool calls all the time. Raised to a threshold that means
// something (a real burst, then genuinely done for a while), plus a global
// cooldown below so several lanes going idle around the same time doesn't
// still stack bubbles back to back.
const IDLE_NOTIFY_MS = 90000;
const IDLE_NOTIFY_MIN_EVENTS = 8;
const IDLE_NOTIFY_COOLDOWN_MS = 120000;
let lastIdleNotifyAt = 0;

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

function handleNotifyEvent(evt) {
  if (evt.kind === 'system') return;
  if (evt.kind === 'error') {
    notify('Fama · Error', evt.detail || evt.label || 'Something went wrong in a session.');
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
      notify('Fama · Idle', "Claude's gone quiet after some activity.");
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
    backgroundColor: '#080b12',
    title: 'Fama',
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
    backgroundColor: '#080b12',
    title: 'Fama setup',
    icon: path.join(__dirname, 'icon.png'), // found live: this window had no icon set, fell back to Electron's default
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
// Migrated from a single confirmed project to a list: one server can now
// watch several at once. currentProjects() lets the onboarding window
// pre-check whatever's already selected when reopened as "manage" rather
// than first-run setup.
function currentProjects() {
  const cfg = loadConfig() || {};
  if (Array.isArray(cfg.watchDirsEncoded)) return cfg.watchDirsEncoded;
  if (cfg.watchDirEncoded) return [cfg.watchDirEncoded]; // pre-multi-folder config
  return [];
}
ipcMain.handle('get-current-projects', () => currentProjects());
ipcMain.handle('confirm-projects', async (event, encodedList) => {
  const list = Array.isArray(encodedList) ? encodedList.filter(Boolean) : [];
  if (!list.length) return false; // nothing selected, caller should keep the window open
  // Merge, don't replace: this used to overwrite the whole config file with
  // just the watched dir(s), silently dropping notificationsEnabled and
  // launchOnStartup back to defaults every time projects were changed.
  saveConfig(Object.assign({}, loadConfig(), { watchDirsEncoded: list }));
  if (onboardingWindow) {
    onboardingWindow.close();
    onboardingWindow = null;
  }
  await startServer(list);
  openMainWindow();
  offerDesktopShortcut();
  return true;
});

ipcMain.handle('get-app-prefs', () => getPrefs());
ipcMain.handle('set-app-prefs', (event, partial) => setPrefs(partial || {}));

// Same flow as the tray's "Manage watched projects…" item, just reachable
// from inside the main window instead of only the tray, which nobody
// reliably discovers on their own.
ipcMain.handle('open-manage-projects', () => {
  if (mainWindow) mainWindow.hide();
  openOnboardingWindow();
});

// --- desktop shortcut ----------------------------------------------------
//
// electron-packager (used here because electron-builder's NSIS step can't
// run in this build environment, see README) produces a plain folder, no
// installer, so nothing puts an icon on the Desktop the way a real installer
// would. This does it directly via PowerShell's WScript.Shell COM object,
// the same mechanism Windows shortcuts (.lnk) are made with, no extra tools.
function desktopShortcutPath() {
  const desktop = path.join(app.getPath('home'), 'Desktop');
  return path.join(desktop, 'Fama.lnk');
}
function createDesktopShortcut() {
  if (!app.isPackaged) return Promise.resolve(false); // dev mode: nothing sane to point a shortcut at
  const target = process.execPath; // Fama.exe itself, icon is already embedded at package time
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
    if (ok) notify('Fama', 'Added a Fama shortcut to your Desktop.');
  });
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
  } catch {
    return; // icon missing or platform quirk, tray is a nice-to-have, not load-bearing
  }
  tray.setToolTip('Fama');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show', click: () => (mainWindow ? mainWindow.show() : openMainWindow()) },
      { label: 'Manage watched projects…', click: () => { if (mainWindow) mainWindow.hide(); openOnboardingWindow(); } },
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
  // watchDirEncoded (singular) is the pre-0.11.0 shape, still read here so
  // upgrading users don't get dropped back into onboarding; currentProjects()
  // normalizes both shapes everywhere else, but the very first read has to
  // happen before that helper's defined below, so it's inlined here too.
  const config = loadConfig();
  const initialProjects = config && Array.isArray(config.watchDirsEncoded)
    ? config.watchDirsEncoded
    : config && config.watchDirEncoded
      ? [config.watchDirEncoded]
      : [];
  if (initialProjects.length) {
    await startServer(initialProjects);
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
