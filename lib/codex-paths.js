'use strict';

const fs = require('fs');
const path = require('path');

const SESSION_META_READ_LIMIT = 1024 * 1024;

function codexSessionsRoot() {
  const home = process.env.USERPROFILE || process.env.HOME;
  return path.join(home, '.codex', 'sessions');
}

function normalizedPath(value) {
  if (!value || typeof value !== 'string') return null;
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(root, candidate) {
  const normalizedRoot = normalizedPath(root);
  const normalizedCandidate = normalizedPath(candidate);
  if (!normalizedRoot || !normalizedCandidate) return false;
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function findProjectForCwd(projects, cwd) {
  if (!Array.isArray(projects) || !cwd) return null;
  // Prefer the most-specific selected project if roots overlap.
  return projects
    .filter((project) => project && project.cwd && isPathInside(project.cwd, cwd))
    .sort((a, b) => normalizedPath(b.cwd).length - normalizedPath(a.cwd).length)[0] || null;
}

function readCodexSessionMeta(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const chunks = [];
    let total = 0;
    while (total < SESSION_META_READ_LIMIT) {
      const size = Math.min(64 * 1024, SESSION_META_READ_LIMIT - total);
      const chunk = Buffer.alloc(size);
      const bytesRead = fs.readSync(fd, chunk, 0, size, total);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
      if (chunk.subarray(0, bytesRead).includes(10)) break; // newline
    }
    const firstLine = Buffer.concat(chunks).toString('utf8').split('\n')[0].trim();
    if (!firstLine) return null;
    const record = JSON.parse(firstLine);
    if (record.type !== 'session_meta' || !record.payload || typeof record.payload !== 'object') return null;
    const sessionId = record.payload.id || record.payload.session_id || null;
    const cwd = typeof record.payload.cwd === 'string' && record.payload.cwd ? record.payload.cwd : null;
    if (!sessionId || !cwd) return null;
    return { sessionId, cwd };
  } catch {
    // A brand-new transcript can be observed between file creation and its
    // first complete JSONL record. The next discovery pass will retry it.
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed or disappeared, retry on the next discovery pass
      }
    }
  }
}

function listJsonlFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
    }
  }
  return files;
}

function activeCodexSessions(root, options = {}) {
  const now = options.now === undefined ? Date.now() : options.now;
  const activeWindowMs = options.activeWindowMs === undefined ? 15 * 60 * 1000 : options.activeWindowMs;
  const sessions = [];
  for (const filePath of listJsonlFiles(root)) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (now - stat.mtimeMs > activeWindowMs) continue;
    const meta = readCodexSessionMeta(filePath);
    if (!meta) continue;
    sessions.push({ filePath, mtimeMs: stat.mtimeMs, size: stat.size, ...meta });
  }
  return sessions;
}

module.exports = {
  activeCodexSessions,
  codexSessionsRoot,
  findProjectForCwd,
  isPathInside,
  listJsonlFiles,
  readCodexSessionMeta,
};
