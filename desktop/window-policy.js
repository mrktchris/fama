'use strict';

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function isLocalAppUrl(value, port) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.port === String(port) && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

function createWindowPolicy({ shell, logger = console }) {
  const hardenedSessions = new WeakSet();

  function hardenSession(session) {
    if (hardenedSessions.has(session)) return;
    hardenedSessions.add(session);
    session.setPermissionCheckHandler(() => false);
    session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    if (typeof session.setDevicePermissionHandler === 'function') session.setDevicePermissionHandler(() => false);
    session.on('will-download', (event) => event.preventDefault());
  }

  function hardenWindowNavigation(window, allowedNavigation) {
    hardenSession(window.webContents.session);
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('will-navigate', (event, url) => {
      if (!allowedNavigation(url)) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      const external = safeExternalUrl(url);
      if (external) {
        shell.openExternal(external).catch((error) => logger.error('[navigation] failed to open external URL', error));
        return { action: 'deny' };
      }
      if (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false },
          },
        };
      }
      return { action: 'deny' };
    });
  }

  function assertIpcSender(event, expectedWindow) {
    if (!expectedWindow || expectedWindow.isDestroyed() || event.sender !== expectedWindow.webContents) {
      throw new Error('Rejected IPC call from an unexpected renderer.');
    }
  }

  return Object.freeze({ assertIpcSender, hardenSession, hardenWindowNavigation });
}

module.exports = { createWindowPolicy, isLocalAppUrl, safeExternalUrl };
