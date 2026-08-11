'use strict';

const RELEASE_URL = 'https://github.com/mrktchris/fama/releases/latest';

class UpdateRuntime {
  constructor({ updater, dialog, shell, app, logger = console }) {
    this._updater = updater;
    this._dialog = dialog;
    this._shell = shell;
    this._app = app;
    this._logger = logger;
    this._manualCheck = false;
    this._downloading = false;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on('update-available', (info) => this._run(() => this._available(info)));
    updater.on('update-downloaded', (info) => this._run(() => this._downloaded(info)));
    updater.on('update-not-available', () => this._notAvailable());
    updater.on('error', (error) => this._run(() => this._error(error)));
  }

  check({ manual = false, packaged = this._app.isPackaged } = {}) {
    if (!packaged) {
      if (manual) {
        return this._dialog.showMessageBox({
          type: 'info',
          title: 'Not available in dev mode',
          message: "Update checks only work in a packaged build; there's nothing to install here.",
        });
      }
      return Promise.resolve();
    }
    this._manualCheck = Boolean(manual);
    return this._updater.checkForUpdates().catch((error) => this._error(error));
  }

  async _available(info) {
    const result = await this._dialog.showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `Fama ${info.version} is available (you're on ${this._app.getVersion()}).`,
      detail: 'Fama can download the verified installer now. Nothing installs until you confirm again after the download.',
      buttons: ['Download update', 'View release', 'Not now'],
      defaultId: 0,
      cancelId: 2,
    });
    this._manualCheck = false;
    if (result.response === 1) {
      await this._shell.openExternal(RELEASE_URL);
      return;
    }
    if (result.response !== 0) return;
    this._downloading = true;
    await this._updater.downloadUpdate();
  }

  async _downloaded(info) {
    this._downloading = false;
    const version = info && info.version ? ` ${info.version}` : '';
    const result = await this._dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: `Fama${version} is downloaded and verified.`,
      detail: 'Restart now to install it, or keep working and install later.',
      buttons: ['Restart and install', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) this._updater.quitAndInstall(false, true);
  }

  _notAvailable() {
    if (!this._manualCheck) return;
    this._manualCheck = false;
    return this._dialog.showMessageBox({
      type: 'info',
      title: 'Up to date',
      message: `You're on the latest version (${this._app.getVersion()}).`,
    });
  }

  _error(error) {
    this._logger.error('[autoUpdater]', error);
    const visible = this._manualCheck || this._downloading;
    this._manualCheck = false;
    this._downloading = false;
    if (!visible) return Promise.resolve();
    return this._dialog.showMessageBox({
      type: 'error',
      title: 'Could not update Fama',
      message: `${error && error.message ? error.message : String(error)}\n\nYou can always use the Releases page.`,
      buttons: ['Open Releases page', 'Close'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => (result.response === 0 ? this._shell.openExternal(RELEASE_URL) : undefined));
  }

  _run(action) {
    Promise.resolve()
      .then(action)
      .catch((error) =>
        Promise.resolve(this._error(error)).catch((reportError) => this._logger.error('[autoUpdater] failed to report error', reportError))
      );
  }
}

module.exports = { RELEASE_URL, UpdateRuntime };
