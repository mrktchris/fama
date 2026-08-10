#!/usr/bin/env node
'use strict';

/**
 * claude-narrator
 * Local live viewer for Claude Code activity. Tails the JSONL session
 * transcripts Claude Code already writes under ~/.claude/projects/<encoded-cwd>/
 * and streams normalized events to a browser over Server-Sent Events.
 *
 * Two voice modes:
 *  - free (default): the browser's own speechSynthesis, zero cost, zero setup.
 *  - cloud (opt-in): OpenAI text-to-speech, needs OPENAI_API_KEY in a local
 *    .env file, costs a small amount per character. See .env.example.
 * The free path always works. Cloud only activates if a key is present.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { FileTailer } = require('./lib/tail');
const { eventsFromRecord } = require('./lib/parse');

// --- tiny .env loader, no dependency needed for something this small ---
function loadDotEnv() {
  let content;
  try {
    content = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  } catch {
    return; // no .env, fine, cloud voice just stays off
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;
const ACTIVE_WINDOW_MS = 15 * 60 * 1000; // a session file counts as "active" if touched in the last 15 min
const POLL_MS = 700;
const BACKLOG_SIZE = 300;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'tts-1-hd';
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy';
const MAX_SPEECH_CHARS = 600; // matches the client's own truncation, this is just a hard backstop

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

// --- optional cloud text-to-speech (OpenAI) --------------------------------

async function synthesizeSpeech(text) {
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_TTS_VOICE,
      input: text,
      response_format: 'mp3',
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`OpenAI TTS ${resp.status}: ${errText.slice(0, 200)}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10000) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// --- http server ------------------------------------------------------

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

  if (req.url === '/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ cloudVoice: Boolean(OPENAI_API_KEY), model: OPENAI_API_KEY ? OPENAI_TTS_MODEL : null }));
    return;
  }

  if (req.url === '/speak' && req.method === 'POST') {
    readJsonBody(req)
      .then(async (body) => {
        const text = (body && body.text ? String(body.text) : '').slice(0, MAX_SPEECH_CHARS);
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'no text' }));
          return;
        }
        if (!OPENAI_API_KEY) {
          res.writeHead(501, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'no OPENAI_API_KEY configured, use the free browser voice instead' }));
          return;
        }
        try {
          const audio = await synthesizeSpeech(text);
          res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length });
          res.end(audio);
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String((err && err.message) || err).slice(0, 300) }));
        }
      })
      .catch(() => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
      });
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
  console.log(`voice: ${OPENAI_API_KEY ? `OpenAI (${OPENAI_TTS_MODEL})` : 'free browser voice (no OPENAI_API_KEY set)'}`);
  console.log(`open http://localhost:${PORT}`);
});
