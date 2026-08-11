'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { RuntimeConfigStore } = require('../desktop/runtime-config');
const { LocalServerRuntime } = require('../desktop/local-server');
const { createWindowPolicy, isLocalAppUrl, safeExternalUrl } = require('../desktop/window-policy');
const { RELEASE_URL, UpdateRuntime } = require('../desktop/update-runtime');

test('Desktop Runtime config preserves unrelated state and filters renderer preferences', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fama-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new RuntimeConfigStore(path.join(root, 'config.json'));
  store.save({ selectedProjects: [{ encoded: '-project' }], secretField: 'keep' });
  const prefs = store.setPrefs({ notificationsEnabled: false, launchOnStartup: 'yes', secretField: 'replace' });
  assert.deepEqual(prefs, { notificationsEnabled: false, launchOnStartup: false });
  assert.equal(store.load().secretField, 'keep');
  assert.deepEqual(store.load().selectedProjects, [{ encoded: '-project' }]);
});

test('Desktop Runtime preserves a browsed project cwd when rebuilding the server watch list', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fama-runtime-projects-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new RuntimeConfigStore(path.join(root, 'config.json'));
  const documents = path.resolve(root, 'Documents');
  const encoded = 'encoded-documents';
  const transcriptDir = path.resolve(root, 'transcripts', encoded);
  store.save({
    selectedProjects: [{ id: 'saved', encoded, dir: transcriptDir, cwd: documents, name: 'Documents' }],
  });

  const projects = store.runtimeProjects({
    projectDirFromEncoded: (candidate) => (candidate === encoded ? transcriptDir : null),
    realCwdFor: () => null,
    encodeProjectDir: (candidate) => (candidate === documents ? encoded : 'unexpected'),
  });

  assert.equal(projects.length, 1);
  assert.equal(projects[0].cwd, documents);
  assert.equal(projects[0].dir, transcriptDir);
  assert.equal(projects[0].name, 'Documents');
});

test('LocalServerRuntime passes one canonical project payload and stops the previous child', async () => {
  const children = [];
  const optionsSeen = [];
  const spawn = (_executable, _args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit('exit', 0);
    children.push(child);
    optionsSeen.push(options);
    return child;
  };
  const runtime = new LocalServerRuntime({
    spawn,
    executable: 'electron.exe',
    serverPath: 'server.js',
    port: 4317,
    userDataPath: 'user-data',
    logger: { log() {}, error() {} },
  });
  const projects = [{ id: 'one', dir: path.resolve('logs'), cwd: path.resolve('source'), name: 'Source' }];
  await runtime.start(projects);
  await runtime.start(projects);
  assert.equal(children.length, 2);
  assert.equal(optionsSeen[1].env.CLAUDE_NARRATOR_DIRS, undefined);
  assert.deepEqual(JSON.parse(optionsSeen[1].env.FAMA_SELECTED_PROJECTS)[0], projects[0]);
  runtime.terminate();
  assert.equal(runtime.isRunning(), false);
});

test('Desktop Runtime window policy accepts only loopback app URLs and credential-free HTTPS externals', () => {
  assert.equal(isLocalAppUrl('http://localhost:4317/settings', 4317), true);
  assert.equal(isLocalAppUrl('http://attacker.test:4317', 4317), false);
  assert.equal(safeExternalUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(safeExternalUrl('https://user:pass@example.com'), null);
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
});

test('Update Runtime requires user confirmation before download and before install', async () => {
  const updater = new EventEmitter();
  let downloads = 0;
  let installs = 0;
  updater.downloadUpdate = async () => { downloads += 1; };
  updater.quitAndInstall = () => { installs += 1; };
  updater.checkForUpdates = async () => {};
  const responses = [{ response: 0 }, { response: 0 }];
  const runtime = new UpdateRuntime({
    updater,
    dialog: { showMessageBox: async () => responses.shift() },
    shell: { openExternal: async () => {} },
    app: { isPackaged: true, getVersion: () => '0.12.4' },
    logger: { error() {} },
  });

  updater.emit('update-available', { version: '0.12.5' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(downloads, 1);
  assert.equal(installs, 0);

  updater.emit('update-downloaded', { version: '0.12.5' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(installs, 1);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.ok(runtime);
});

test('Update Runtime skips portable builds without updater metadata', async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => assert.fail('unsupported build must not contact the updater');
  const dialogs = [];
  const releases = [];
  const runtime = new UpdateRuntime({
    updater,
    dialog: { showMessageBox: async (options) => { dialogs.push(options); return { response: 0 }; } },
    shell: { openExternal: async (url) => releases.push(url) },
    app: { isPackaged: true, getVersion: () => '0.12.4' },
    logger: { error() {} },
  });

  await runtime.check({ manual: true, available: false });
  assert.equal(dialogs[0].title, 'Updates unavailable in this build');
  assert.deepEqual(releases, [RELEASE_URL]);
});

test('Update Runtime surfaces a confirmed download failure without installing', async () => {
  const updater = new EventEmitter();
  updater.downloadUpdate = async () => {
    throw new Error('download failed');
  };
  updater.quitAndInstall = () => assert.fail('failed download must not install');
  updater.checkForUpdates = async () => {};
  const dialogs = [];
  const errors = [];
  new UpdateRuntime({
    updater,
    dialog: {
      showMessageBox: async (options) => {
        dialogs.push(options);
        return { response: dialogs.length === 1 ? 0 : 1 };
      },
    },
    shell: { openExternal: async () => {} },
    app: { isPackaged: true, getVersion: () => '0.12.4' },
    logger: { error: (...args) => errors.push(args) },
  });

  updater.emit('update-available', { version: '0.12.5' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dialogs[0].title, 'Update available');
  assert.equal(dialogs[1].title, 'Could not update Fama');
  assert.equal(errors.length, 1);
});

test('Desktop Runtime window policy denies permissions, unexpected IPC, and unsafe navigation', async () => {
  const listeners = new Map();
  let permissionCheck;
  let permissionRequest;
  let openHandler;
  const session = {
    setPermissionCheckHandler(handler) {
      permissionCheck = handler;
    },
    setPermissionRequestHandler(handler) {
      permissionRequest = handler;
    },
    setDevicePermissionHandler() {},
    on(name, handler) {
      listeners.set(`session:${name}`, handler);
    },
  };
  const webContents = {
    session,
    on(name, handler) {
      listeners.set(name, handler);
    },
    setWindowOpenHandler(handler) {
      openHandler = handler;
    },
  };
  const window = { webContents, isDestroyed: () => false };
  const opened = [];
  const policy = createWindowPolicy({ shell: { openExternal: async (url) => opened.push(url) } });
  policy.hardenWindowNavigation(window, (url) => url === 'http://localhost:4317/');

  assert.equal(permissionCheck(), false);
  let permissionAllowed = true;
  permissionRequest(null, null, (allowed) => (permissionAllowed = allowed));
  assert.equal(permissionAllowed, false);
  let prevented = false;
  listeners.get('will-navigate')({ preventDefault: () => (prevented = true) }, 'https://attacker.test');
  assert.equal(prevented, true);
  assert.equal(openHandler({ url: 'javascript:alert(1)' }).action, 'deny');
  assert.equal(openHandler({ url: 'data:image/png;base64,AA==' }).action, 'allow');
  assert.equal(openHandler({ url: 'https://example.com' }).action, 'deny');
  await Promise.resolve();
  assert.deepEqual(opened, ['https://example.com/']);
  assert.doesNotThrow(() => policy.assertIpcSender({ sender: webContents }, window));
  assert.throws(() => policy.assertIpcSender({ sender: {} }, window), /unexpected renderer/);
});
