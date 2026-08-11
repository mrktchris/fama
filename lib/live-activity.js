'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FileTailer } = require('./tail');
const { eventsFromRecord } = require('./parse');
const { eventsFromCodexRecord } = require('./parse-codex');
const { activeCodexSessions, findProjectForCwd } = require('./codex-paths');

class SseEventFeed {
  constructor({ maxEvents = 300, maxBytes = 2 * 1024 * 1024 } = {}) {
    this.maxEvents = maxEvents;
    this.maxBytes = maxBytes;
    this._backlog = [];
    this._backlogBytes = 0;
    this._clients = new Set();
  }

  publish(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const bytes = Buffer.byteLength(payload);
    this._backlog.push({ payload, bytes });
    this._backlogBytes += bytes;
    while (this._backlog.length > 1 && (this._backlog.length > this.maxEvents || this._backlogBytes > this.maxBytes)) {
      this._backlogBytes -= this._backlog.shift().bytes;
    }
    for (const client of this._clients) client.write(payload);
    return event;
  }

  subscribe(client, { replay = true } = {}) {
    if (replay) this.replay(client);
    this._clients.add(client);
    return () => this._clients.delete(client);
  }

  replay(client) {
    for (const item of this._backlog) client.write(item.payload);
  }

  snapshot() {
    return Object.freeze({ events: this._backlog.length, bytes: this._backlogBytes, clients: this._clients.size });
  }
}

class LiveActivityIngest {
  constructor(options) {
    this.projects = options.projects;
    this.feed = options.feed || new SseEventFeed(options.backlog);
    this.codexSessionsDir = options.codexSessionsDir;
    this.activeWindowMs = options.activeWindowMs || 15 * 60 * 1000;
    this.codexDiscoveryMs = options.codexDiscoveryMs || 1000;
    this.pollMs = options.pollMs || 250;
    this._fs = options.fs || fs;
    this._path = options.path || path;
    this._FileTailer = options.FileTailer || FileTailer;
    this._parseClaude = options.parseClaudeRecord || eventsFromRecord;
    this._parseCodex = options.parseCodexRecord || eventsFromCodexRecord;
    this._listCodexSessions = options.listCodexSessions || activeCodexSessions;
    this._matchProject = options.matchProjectForCwd || findProjectForCwd;
    this._now = options.now || Date.now;
    this._setInterval = options.setInterval || setInterval;
    this._clearInterval = options.clearInterval || clearInterval;
    this._tailers = new Map();
    this._activeCodexPaths = new Set();
    this._lastCodexDiscoveryAt = 0;
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    this.scan();
    this._timer = this._setInterval(() => this.poll(), this.pollMs);
  }

  stop() {
    if (this._timer) this._clearInterval(this._timer);
    this._timer = null;
    this._tailers.clear();
    this._activeCodexPaths.clear();
  }

  poll() {
    this.scan();
    for (const tailer of this._tailers.values()) tailer.poll();
  }

  scan(now = this._now()) {
    const seen = this._scanClaude(now);
    if (now - this._lastCodexDiscoveryAt >= this.codexDiscoveryMs) {
      this._activeCodexPaths = this._scanCodex(now);
      this._lastCodexDiscoveryAt = now;
    }
    for (const filePath of this._activeCodexPaths) seen.add(filePath);
    for (const filePath of this._tailers.keys()) {
      if (!seen.has(filePath)) this._tailers.delete(filePath);
    }
    return this.status();
  }

  subscribe(client, options) {
    return this.feed.subscribe(client, options);
  }

  status() {
    return Object.freeze({ projects: this.projects.length, sessions: this._tailers.size, feed: this.feed.snapshot() });
  }

  _publishRecords(records, project, provider, context) {
    const parse = provider === 'claude' ? this._parseClaude : this._parseCodex;
    for (const record of records) {
      if (provider === 'codex' && record && record.type === 'session_meta' && record.payload) {
        context.sessionId = record.payload.id || record.payload.session_id || context.sessionId;
      }
      for (const event of parse(record, context)) {
        this.feed.publish(Object.assign(event, { provider, projectId: project.id, projectName: project.name }));
      }
    }
  }

  _attach(filePath, size, onRecords) {
    if (this._tailers.has(filePath)) return;
    const tailer = new this._FileTailer(filePath, onRecords);
    // Live Activity is deliberately not a transcript replay: existing bytes
    // become the starting offset and only later appends are published.
    tailer.offset = size;
    this._tailers.set(filePath, tailer);
  }

  _scanClaude(now) {
    const seen = new Set();
    for (const project of this.projects) {
      let entries;
      try {
        entries = this._fs.readdirSync(project.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const filePath = this._path.join(project.dir, entry.name);
        let stat;
        try {
          stat = this._fs.statSync(filePath);
        } catch {
          continue;
        }
        if (now - stat.mtimeMs > this.activeWindowMs) continue;
        seen.add(filePath);
        this._attach(filePath, stat.size, (records) => this._publishRecords(records, project, 'claude'));
      }
    }
    return seen;
  }

  _scanCodex(now) {
    const seen = new Set();
    for (const session of this._listCodexSessions(this.codexSessionsDir, { now, activeWindowMs: this.activeWindowMs })) {
      const project = this._matchProject(this.projects, session.cwd);
      if (!project) continue;
      seen.add(session.filePath);
      const context = { sessionId: session.sessionId };
      this._attach(session.filePath, session.size, (records) => this._publishRecords(records, project, 'codex', context));
    }
    return seen;
  }
}

module.exports = { LiveActivityIngest, SseEventFeed };
