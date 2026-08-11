'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { encodedSelectionFromConfig } = require('../lib/selected-projects');

const DEFAULT_PREFS = Object.freeze({ notificationsEnabled: true, launchOnStartup: false });
const SETTABLE_PREF_KEYS = Object.freeze(['notificationsEnabled', 'launchOnStartup']);

class RuntimeConfigStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this._fs = options.fs || fs;
  }

  load() {
    try {
      const parsed = JSON.parse(this._fs.readFileSync(this.filePath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  save(config) {
    this._fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this._fs.writeFileSync(this.filePath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      this._fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Windows applies the per-user directory ACL.
    }
    return config;
  }

  update(patch) {
    return this.save(Object.assign({}, this.load(), patch));
  }

  prefs() {
    const config = this.load();
    return Object.freeze({
      notificationsEnabled:
        typeof config.notificationsEnabled === 'boolean' ? config.notificationsEnabled : DEFAULT_PREFS.notificationsEnabled,
      launchOnStartup: typeof config.launchOnStartup === 'boolean' ? config.launchOnStartup : DEFAULT_PREFS.launchOnStartup,
    });
  }

  setPrefs(partial) {
    const config = this.load();
    for (const key of SETTABLE_PREF_KEYS) {
      if (typeof partial[key] === 'boolean') config[key] = partial[key];
    }
    this.save(config);
    return this.prefs();
  }

  encodedSelection(projectDirFromEncoded) {
    return encodedSelectionFromConfig(this.load(), projectDirFromEncoded);
  }

  setSelectedProjects(projects) {
    const config = this.load();
    config.selectedProjects = projects.map(({ id, encoded, dir, cwd, name }) => ({ id, encoded, dir, cwd, name }));
    delete config.watchDirEncoded;
    delete config.watchDirsEncoded;
    this.save(config);
    return config.selectedProjects;
  }
}

module.exports = { DEFAULT_PREFS, RuntimeConfigStore, SETTABLE_PREF_KEYS };
