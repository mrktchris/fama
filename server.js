#!/usr/bin/env node
'use strict';

/**
 * claude-narrator
 * Local, zero-dependency live viewer for Claude Code activity.
 * Tails the JSONL session transcripts Claude Code already writes under
 * ~/.claude/projects/<encoded-cwd>/ and streams normalized events to a
 * browser over Server-Sent Events. No API calls, no extra token cost,
 * nothing leaves the machine.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { FileTailer } = require('./lib/tail');
const { eventsFromRecord } = require('./lib/parse');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;
const ACTIVE_WINDOW_MS = 15 * 60 * 1000; // a session file counts as "active" if touched in the last 15 min
const POLL_MS = 700;
const BACKLOG_SIZE = 300;

// Mirrors Claude Code's own project-folder naming: "C:\Users\User\Documents\Claude"
// becomes "C--Users-User-Documents-Claude". Verified against real files on this machine.
function encodeProjectDir(cwd) {
  return cwd.replace(/^([A-Za-z]):\\/, '$1--').replace(/\\/g, '-');
}

function claudeProjectsRoot() {
  const home = process.env.USERPROFILE || process.env.HOME;
  return path.join(home, '.claude', 'projects');
}

function resolveWatchDir() {
  if (process.env.CLAUDE_NARRATOR_DIR) return process.env.CLAUDE_NARRATOR_DIR;
  const encoded = encodeProjectDir(process.cwd());
  return path.join(claudeProjectsRoot(), encoded);
}

const watchDir = resolveWatchDir();

const backlog = [];
const sseClients = new Set();
const tailers = new Map(); // filePath -> FileTailer

function broadcast(event) {
  backlog.push(event);
  if (backlog.length > BACKLOG_SIZE) backlog.shift();
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function handleNewRecords(records) {
  for (const record of records) {
    for (const event of eventsFromRecord(record)) {
      broadcast(event);
    }
  }
}

function scanForActiveSessions() {
  let entries;
  try {
    entries = fs.readdirSync(watchDir, { withFileTypes: true });
  } catch (err) {
    return; // watch dir doesn't exist yet (brand new project, no sessions written yet)
  }
  const now = Date.now();
  for (const entry of entries) {
    // Only top-level *.jsonl. Subagent transcripts live in a nested subagents/
    // folder and are deliberately skipped in v0.1 (see README roadmap).
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const filePath = path.join(watchDir, entry.name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (now - stat.mtimeMs > ACTIVE_WINDOW_MS) continue; // stale session, not currently active
    if (!tailers.has(filePath)) {
      const tailer = new FileTailer(filePath, handleNewRecords);
      // Seed at end-of-file: on startup we only stream what happens FROM NOW ON.
      // Files that already existed keep their history out of the feed on purpose,
      // this is a live narrator, not a replay tool.
      tailer.offset = stat.size;
      tailers.set(filePath, tailer);
    }
  }
}

setInterval(() => {
  scanForActiveSessions();
  for (const tailer of tailers.values()) tailer.poll();
}, POLL_MS);
scanForActiveSessions();

const viewerDir = path.join(__dirname, 'viewer');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ kind: 'system', label: 'connected', detail: `watching ${watchDir}` })}\n\n`);
    for (const event of backlog) res.write(`data: ${JSON.stringify(event)}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(viewerDir, path.normalize(filePath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(viewerDir)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// Bind to loopback only. This feed includes file paths, thinking, and tool
// output, it has no business being reachable from anything else on the LAN.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`claude-narrator watching: ${watchDir}`);
  console.log(`open http://localhost:${PORT}`);
});
