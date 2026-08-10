'use strict';

/**
 * claude-narrator desktop shell (Electron).
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

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 4317;
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

let serverProcess = null;
let mainWindow = null;
let onboardingWindow = null;
let tray = null;

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

function startServer(watchDirEncoded) {
  const projectDir = path.join(claudeProjectsRoot(), watchDirEncoded);
  serverProcess = spawn('node', [path.join(ROOT, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), CLAUDE_NARRATOR_DIR: projectDir }),
    windowsHide: true,
  });
  serverProcess.stdout.on('data', (d) => console.log(`[server] ${d}`.trim()));
  serverProcess.stderr.on('data', (d) => console.error(`[server] ${d}`.trim()));
  serverProcess.on('exit', (code) => console.log(`[server] exited with code ${code}`));
}

let isQuitting = false;

function openMainWindow() {
  mainWindow = new BrowserWindow({
    width: 780,
    height: 640,
    minWidth: 420,
    minHeight: 400,
    backgroundColor: '#0a0a0c',
    title: 'claude-narrator',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, spellcheck: true, autoplayPolicy: 'no-user-gesture-required' },
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
    title: 'claude-narrator setup',
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
ipcMain.handle('confirm-project', (event, encoded) => {
  saveConfig({ watchDirEncoded: encoded });
  if (onboardingWindow) {
    onboardingWindow.close();
    onboardingWindow = null;
  }
  startServer(encoded);
  openMainWindow();
});

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
  } catch {
    return; // icon missing or platform quirk, tray is a nice-to-have, not load-bearing
  }
  tray.setToolTip('claude-narrator');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show', click: () => (mainWindow ? mainWindow.show() : openMainWindow()) },
      { label: 'Change watched project…', click: () => { if (mainWindow) mainWindow.hide(); openOnboardingWindow(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ])
  );
}

app.whenReady().then(() => {
  createTray();
  const config = loadConfig();
  if (config && config.watchDirEncoded) {
    startServer(config.watchDirEncoded);
    openMainWindow();
  } else {
    openOnboardingWindow();
  }
});

// Deliberately no window-all-closed handler. The main window hides instead of
// closing (see the 'close' listener above), and if it's the onboarding
// window that closes without a tray, that's a genuinely broken state (no
// icon.png yet, see the icon TODO), not one to silently paper over by quitting.

app.on('before-quit', () => {
  isQuitting = true;
  if (serverProcess) serverProcess.kill();
});
