'use strict';

const path = require('node:path');
const { selectedProjectsEnvironment } = require('../lib/selected-projects');

class LocalServerRuntime {
  constructor(options) {
    this._spawn = options.spawn;
    this._executable = options.executable;
    this._serverPath = options.serverPath;
    this._port = options.port;
    this._userDataPath = options.userDataPath;
    this._baseEnv = options.env || process.env;
    this._logger = options.logger || console;
    this._onStarted = options.onStarted || (() => {});
    this._onStopping = options.onStopping || (() => {});
    this._onError = options.onError || (() => {});
    this._process = null;
  }

  isRunning() {
    return Boolean(this._process);
  }

  async start(projects) {
    if (!Array.isArray(projects) || !projects.length) throw new Error('At least one Selected Project is required.');
    await this.stop();
    const child = this._spawn(this._executable, [this._serverPath], {
      env: Object.assign({}, this._baseEnv, {
        PORT: String(this._port),
        FAMA_ENV_PATH: path.join(this._userDataPath, '.env'),
        FAMA_USAGE_PATH: path.join(this._userDataPath, 'usage.json'),
        FAMA_SELECTED_PROJECTS: selectedProjectsEnvironment(projects),
        ELECTRON_RUN_AS_NODE: '1',
      }),
      windowsHide: true,
    });
    this._process = child;
    this._onStarted(child);
    if (child.stdout) child.stdout.on('data', (data) => this._logger.log(`[server] ${data}`.trim()));
    if (child.stderr) child.stderr.on('data', (data) => this._logger.error(`[server] ${data}`.trim()));
    child.on('exit', (code) => {
      if (this._process === child) this._process = null;
      this._logger.log(`[server] exited with code ${code}`);
    });
    child.on('error', (error) => this._onError(error));
    return child;
  }

  stop() {
    this._onStopping();
    if (!this._process) return Promise.resolve();
    const child = this._process;
    this._process = null;
    return new Promise((resolve) => {
      let resolved = false;
      let timeout;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (timeout) clearTimeout(timeout);
        resolve();
      };
      child.once('exit', finish);
      timeout = setTimeout(finish, 2000);
      if (typeof timeout.unref === 'function') timeout.unref();
      child.kill();
    });
  }

  terminate() {
    this._onStopping();
    if (this._process) this._process.kill();
    this._process = null;
  }
}

module.exports = { LocalServerRuntime };
