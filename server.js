#!/usr/bin/env node
'use strict';

/**
 * Fama
 * Local live viewer for Claude Code activity. Tails the JSONL session
 * transcripts Claude Code already writes under ~/.claude/projects/<encoded-cwd>/
 * and streams normalized events to a browser over Server-Sent Events.
 *
 * Voice, two layers, both optional and both degrade gracefully:
 *  - synthesis: free browser speechSynthesis, or OpenAI TTS if a key is
 *    configured (Settings panel in the UI, or a hand-edited .env).
 *  - rewrite: when cloud voice is on, thinking/text gets a quick pass through
 *    a cheap chat model first, turning raw internal-monologue prose into a
 *    short natural spoken line, instead of reading it verbatim. Target length
 *    is user-controlled (narrationSeconds: 5/10/20), longer means more words
 *    survive the rewrite and more characters get synthesized, which is
 *    directly more credits, the tradeoff is intentional and shown in the UI.
 * Nothing here is required. With zero configuration this is still a fully
 * working, zero-cost, zero-API local tool.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FileTailer } = require('./lib/tail');

// A fresh random token per process, required as a header on every route that
// mutates anything or spends money. Not persisted anywhere, not needed to be:
// it only has to prove the caller is the actual page this server just served,
// not some other tab/site. Delivered to the page by injecting it into
// index.html at serve time (see the static handler below), so only same-
// origin JS ever sees it, a cross-origin fetch can't read a response to
// extract it, and a plain <form> POST (the classic no-JS CSRF vector) can't
// set a custom header at all. Found missing entirely by external review:
// a malicious webpage could otherwise trigger real, billable /speak calls
// against a visitor's local Fama instance just by POSTing to it.
//
// This alone assumes "same-origin" is a stable, attacker-proof boundary,
// which DNS rebinding defeats: a page can rebind its own hostname to
// 127.0.0.1 and become same-origin with this server, at which point it CAN
// read the token out of index.html like any other same-origin page. The
// Host-header allowlist below (see ALLOWED_HOSTS) is what actually closes
// that gap, by rejecting anything that didn't arrive addressed to the real
// loopback name — found by a later, deeper security audit, this token was
// never sufficient on its own.
const AUTH_TOKEN = crypto.randomBytes(24).toString('hex');
function requireAuth(req, res) {
  if (req.headers['x-fama-token'] === AUTH_TOKEN) return true;
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'missing or invalid token' }));
  return false;
}
const { eventsFromRecord } = require('./lib/parse');

// Root cause of a real, serious incident: writeDotEnv() used to always write
// next to server.js. That's correct for a source checkout, but for a
// PACKAGED desktop app that path is inside the app's own read-only resources
// folder, which then means every Settings save writes a live API key
// straight into a directory that gets zipped/uploaded/reinstalled with the
// app itself. That's exactly how a real key ended up inside a public GitHub
// release asset. desktop/main.js now passes FAMA_ENV_PATH pointing at
// Electron's actual per-user data directory when running packaged; this only
// falls back to sitting next to server.js for the plain `npm start` /
// source-checkout case, where that's the correct, expected place for it.
const ENV_PATH = process.env.FAMA_ENV_PATH || path.join(__dirname, '.env');

// --- tiny .env loader/writer, no dependency needed for something this small ---
function loadDotEnv() {
  let content;
  try {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  } catch {
    return {}; // no .env, fine, cloud voice just stays off until Settings writes one
  }
  const values = {};
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
    values[key] = value;
  }
  return values;
}

function writeDotEnv(config) {
  // Every interpolated value gets newline-stripped, not just the two that
  // used to be: an unsanitized field here lets a value containing its own
  // "\nOPENAI_API_KEY=..." line inject a second key that loadDotEnv's
  // last-wins parsing would treat as authoritative. Found by security audit.
  const clean = (v) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ');
  const lines = [
    '# Written by the Fama Settings panel (the gear icon in the app).',
    '# Hand edits are fine, but hitting Save there rewrites these lines.',
    '',
    `OPENAI_API_KEY=${clean(config.apiKey)}`,
    `OPENAI_TTS_MODEL=${clean(config.model || 'tts-1-hd')}`,
    `OPENAI_TTS_VOICE=${clean(config.voice || 'alloy')}`,
    `OPENAI_REWRITE_MODEL=${clean(config.rewriteModel || 'gpt-4o-mini')}`,
    `OPENAI_NARRATE_REWRITE=${config.rewrite === false ? 'false' : 'true'}`,
    `OPENAI_NARRATION_SECONDS=${config.narrationSeconds || 10}`,
    `OPENAI_NARRATION_PERSONA=${clean(config.narrationPersona)}`,
    `OPENAI_VOICE_STYLE=${clean(config.voiceStyle)}`,
    '',
  ];
  // 0600: this file holds a plaintext API key. `mode` only applies when the
  // file is newly created, so chmod the existing one too on every save (a
  // no-op on Windows, where ACLs govern instead, wrapped so that's not an
  // error there). Matters on shared POSIX machines; Windows userData is
  // already per-user by ACL regardless.
  fs.writeFileSync(ENV_PATH, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(ENV_PATH, 0o600);
  } catch {
    // not supported on Windows, fine, ACLs handle it there
  }
}

function envBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

// Narration length is a continuous dial, not fixed presets, so "a lot of
// options" just falls out of the formula: any whole second from 3 to 30 is a
// valid target. Word count assumes a natural ~150wpm speaking rate; maxTokens
// carries headroom so the model can actually land near the target instead of
// getting cut off mid-sentence.
const NARRATION_MIN_SECONDS = 3;
const NARRATION_MAX_SECONDS = 30;
function clampNarrationSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return 10;
  return Math.min(NARRATION_MAX_SECONDS, Math.max(NARRATION_MIN_SECONDS, Math.round(n)));
}
function narrationPreset(seconds) {
  const s = clampNarrationSeconds(seconds);
  const words = Math.max(6, Math.round(s * 2.5));
  // Generous on purpose: a few hundred extra output tokens on a model this
  // cheap costs a rounding error, getting cut off mid-word does not. Technical
  // vocabulary (dependencies, maintainability...) tokenizes far less
  // efficiently than the ~1.3 tokens/word rule of thumb, 2.2x truncated real
  // 30s output during testing, this wider margin is measured, not a guess.
  const maxTokens = Math.round(words * 4) + 40;
  return { seconds: s, words, maxTokens };
}
function clampSpeed(speed) {
  const n = Number(speed);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0.5, n)); // OpenAI allows 0.25-4.0, keeping the UI to a sane-sounding range
}

const envFile = loadDotEnv();
// Real environment variables win over .env, same convention as every other
// dotenv-style tool, useful if key management ever moves to the OS/process
// level instead of this local file.
let ttsConfig = {
  apiKey: process.env.OPENAI_API_KEY || envFile.OPENAI_API_KEY || '',
  model: process.env.OPENAI_TTS_MODEL || envFile.OPENAI_TTS_MODEL || 'tts-1-hd',
  voice: process.env.OPENAI_TTS_VOICE || envFile.OPENAI_TTS_VOICE || 'alloy',
  rewriteModel: process.env.OPENAI_REWRITE_MODEL || envFile.OPENAI_REWRITE_MODEL || 'gpt-4o-mini',
  rewrite: envBool(process.env.OPENAI_NARRATE_REWRITE || envFile.OPENAI_NARRATE_REWRITE, true),
  narrationSeconds: clampNarrationSeconds(process.env.OPENAI_NARRATION_SECONDS || envFile.OPENAI_NARRATION_SECONDS || 10),
  // Free text, both optional and both blank by default. persona shapes the
  // rewrite step's system prompt (works with any TTS model). voiceStyle is
  // passed as OpenAI's "instructions" param, which only gpt-4o-mini-tts
  // actually supports, tts-1/tts-1-hd silently ignore it if sent, so it's
  // only sent when that model is selected, see synthesizeSpeech below.
  narrationPersona: process.env.OPENAI_NARRATION_PERSONA || envFile.OPENAI_NARRATION_PERSONA || '',
  voiceStyle: process.env.OPENAI_VOICE_STYLE || envFile.OPENAI_VOICE_STYLE || '',
};

// --- usage / spend tracking, local only, persisted to usage.json (gitignored) ---
// Same class of bug as the .env write-path incident, found by the same
// external audit: this defaulted to path.join(__dirname, ...), which for a
// packaged build resolves inside resources/app, not per-user data. Nothing
// secret lives in usage.json, so this was never a credential leak, but it
// meant usage history didn't survive an update (a fresh package = a fresh
// empty file) and, same as .env, technically got copied into the zip on
// every build if a real one existed in the source tree. FAMA_USAGE_PATH lets
// the desktop shell point this at app.getPath('userData'), matching FAMA_ENV_PATH.
const USAGE_PATH = process.env.FAMA_USAGE_PATH || path.join(__dirname, 'usage.json');
// Best-effort $ estimates, labelled as such in the UI rather than presented
// as exact. tts-1/tts-1-hd are flat per-character billing, confirmed against
// OpenAI's own pricing. gpt-4o-mini-tts bills audio output at roughly
// $12/1M units against the same pricing page (plus a separate, much smaller
// per-token text-input charge this doesn't model, narration lines are short
// enough that it's noise next to the output cost) — approximated here at
// that output rate rather than reused from tts-1, closer to the real number
// but still an approximation: OpenAI's own docs describe this billing
// structure ambiguously (character vs. token unit) even cross-referenced
// against two of their own pages, so this is not asserted as exact.
const PRICE_PER_CHAR = { 'tts-1': 0.000015, 'tts-1-hd': 0.00003, 'gpt-4o-mini-tts': 0.000012 };
const REWRITE_PRICE_PER_TOKEN = { prompt: 0.00000015, completion: 0.0000006 }; // gpt-4o-mini, $0.15 / $0.60 per 1M

function loadUsage() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_PATH, 'utf8'));
  } catch {
    return { totalCost: 0, ttsCalls: 0, ttsChars: 0, rewriteCalls: 0, rewriteTokens: 0, since: new Date().toISOString() };
  }
}
let usage = loadUsage();
function saveUsage() {
  try {
    fs.writeFileSync(USAGE_PATH, JSON.stringify(usage, null, 2), 'utf8');
  } catch {
    // non-fatal, worst case usage just isn't persisted across a restart
  }
}
function recordUsage({ ttsChars, ttsModel, rewritePromptTokens, rewriteCompletionTokens }) {
  const ttsPrice = PRICE_PER_CHAR[ttsModel] || PRICE_PER_CHAR['tts-1-hd'];
  let cost = (ttsChars || 0) * ttsPrice;
  usage.ttsCalls += 1;
  usage.ttsChars += ttsChars || 0;
  if (rewritePromptTokens || rewriteCompletionTokens) {
    cost += (rewritePromptTokens || 0) * REWRITE_PRICE_PER_TOKEN.prompt + (rewriteCompletionTokens || 0) * REWRITE_PRICE_PER_TOKEN.completion;
    usage.rewriteCalls += 1;
    usage.rewriteTokens += (rewritePromptTokens || 0) + (rewriteCompletionTokens || 0);
  }
  usage.totalCost += cost;
  saveUsage();
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;
const ACTIVE_WINDOW_MS = 15 * 60 * 1000; // a session file counts as "active" if touched in the last 15 min
const POLL_MS = 250; // how often we check transcripts for new lines, kept tight on purpose, see README
const BACKLOG_SIZE = 300;
const MAX_SPEECH_CHARS = 900; // hard backstop, comfortably above even the 20s preset's typical output

function encodeProjectDir(cwd) {
  // Mirrors Claude Code's own project-folder naming. Windows: "C:\Users\User\Documents\Claude"
  // becomes "C--Users-User-Documents-Claude" (verified against real files on this machine).
  // macOS/Linux: "/Users/name/project" becomes "-Users-name-project" (every "/" -> "-",
  // including the leading one). This half of it is implemented from Claude Code's known
  // encoding scheme, not verified against a real Mac/Linux machine in this environment,
  // README calls that out rather than claiming full cross-platform parity untested.
  if (/^[A-Za-z]:\\/.test(cwd)) return cwd.replace(/^([A-Za-z]):\\/, '$1--').replace(/\\/g, '-');
  return cwd.replace(/\//g, '-');
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

// Multiple projects at once: the desktop shell passes JSON arrays of
// absolute dirs + friendly labels (CLAUDE_NARRATOR_DIRS / FAMA_PROJECT_LABELS,
// see desktop/main.js). CLI mode (no Electron) still watches exactly the one
// project it was launched from, wrapped as a one-entry array so the rest of
// the pipeline doesn't need two code paths. Each project gets a stable id
// (its index) used to tag every event and group lanes client-side.
function resolveWatchProjects() {
  if (process.env.CLAUDE_NARRATOR_DIRS) {
    let dirs, labels;
    try {
      dirs = JSON.parse(process.env.CLAUDE_NARRATOR_DIRS);
      labels = process.env.FAMA_PROJECT_LABELS ? JSON.parse(process.env.FAMA_PROJECT_LABELS) : [];
    } catch {
      dirs = [];
    }
    if (Array.isArray(dirs) && dirs.length) {
      return dirs.map((dir, i) => ({ id: String(i), dir, name: labels[i] || path.basename(dir) }));
    }
  }
  // Single-project fallback: env override or the cwd-derived default.
  const dir = resolveWatchDir();
  const name = process.env.FAMA_PROJECT_LABEL || path.basename(process.cwd());
  return [{ id: '0', dir, name }];
}

const watchProjects = resolveWatchProjects();

const backlog = [];
const sseClients = new Set();
const tailers = new Map(); // filePath -> FileTailer

function broadcast(event) {
  backlog.push(event);
  if (backlog.length > BACKLOG_SIZE) backlog.shift();
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function handleNewRecords(records, project) {
  for (const record of records) {
    for (const event of eventsFromRecord(record)) {
      broadcast(Object.assign(event, { projectId: project.id, projectName: project.name }));
    }
  }
}

function scanForActiveSessions() {
  const now = Date.now();
  const seenThisScan = new Set();
  for (const project of watchProjects) {
    let entries;
    try {
      entries = fs.readdirSync(project.dir, { withFileTypes: true });
    } catch (err) {
      continue; // this watch dir doesn't exist yet (brand new project, no sessions written yet)
    }
    for (const entry of entries) {
      // Only top-level *.jsonl. Subagent transcripts live in a nested subagents/
      // folder and are deliberately skipped in v0.1 (see README roadmap).
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const filePath = path.join(project.dir, entry.name);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (now - stat.mtimeMs > ACTIVE_WINDOW_MS) continue; // stale session, not currently active
      seenThisScan.add(filePath);
      if (!tailers.has(filePath)) {
        const tailer = new FileTailer(filePath, (records) => handleNewRecords(records, project));
        // Seed at end-of-file: on startup we only stream what happens FROM NOW ON.
        // Files that already existed keep their history out of the feed on purpose,
        // this is a live narrator, not a replay tool.
        tailer.offset = stat.size;
        tailers.set(filePath, tailer);
      }
    }
  }
  // Tailers used to only ever get added, never removed, so a long-running
  // process (the whole point of the tray icon) would keep statSync/open/poll
  // cycling on every session it had ever seen go active, forever. Anything
  // that aged out of the active window this scan gets dropped.
  for (const filePath of tailers.keys()) {
    if (!seenThisScan.has(filePath)) tailers.delete(filePath);
  }
}

setInterval(() => {
  scanForActiveSessions();
  for (const tailer of tailers.values()) tailer.poll();
}, POLL_MS);
scanForActiveSessions();

// --- optional cloud voice: rewrite + text-to-speech (OpenAI) ---------------

async function rewriteForSpeech(text, kind) {
  const context =
    kind === 'thinking'
      ? 'This is raw internal reasoning, often fragmented or rambling as it is being worked out.'
      : 'This is already meant to be read by a person, just make it work as spoken audio.';
  const preset = narrationPreset(ttsConfig.narrationSeconds);
  const personaLine = ttsConfig.narrationPersona
    ? `Voice/persona for this rewrite: ${ttsConfig.narrationPersona}. Stay in that voice, but the length limit below is non-negotiable regardless of persona. `
    : '';
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ttsConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ttsConfig.rewriteModel,
      messages: [
        {
          role: 'system',
          content:
            "You narrate a coding agent's live activity out loud, in real time, for someone half-listening while they work on something else. " +
            personaLine +
            `HARD LIMIT: ${preset.words} words maximum, count them as you write and stop at the limit even mid-thought. ` +
            'Present tense, natural spoken sentences. ' +
            'Never start with a filler opener like "So", "Well", "Okay so", "Now", or "Alright", get straight into the actual content. ' +
            'No code, no file paths, no markdown, no meta-commentary about what you are doing right now, just the plain-language gist of it. ' +
            'Reply with only the rewritten line and nothing else.',
        },
        { role: 'user', content: `${context}\n\nRewrite this in ${preset.words} words or fewer:\n\n${text}` },
      ],
      max_tokens: preset.maxTokens,
      temperature: 0.2,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`OpenAI rewrite ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const u = data && data.usage;
  return { text: (out || '').trim(), promptTokens: (u && u.prompt_tokens) || 0, completionTokens: (u && u.completion_tokens) || 0 };
}

async function synthesizeSpeech(text, speed) {
  const payload = {
    model: ttsConfig.model,
    voice: ttsConfig.voice,
    input: text,
    response_format: 'mp3',
    speed: clampSpeed(speed),
  };
  // instructions (accent, tone, delivery) is only honored by gpt-4o-mini-tts.
  // tts-1/tts-1-hd are older fixed-delivery models, sending it there either
  // gets silently ignored or rejected depending on the day, so just don't.
  //
  // A bare word or two ("dominican", "calm") measurably under-steers the
  // model, confirmed by testing: a one-word instruction came back byte-
  // identical to no instruction at all, a fuller sentence did not. So short
  // input gets expanded into an actual directive rather than sent as-is,
  // the field stays free text, this just gives the model more to act on.
  if (ttsConfig.voiceStyle && ttsConfig.model === 'gpt-4o-mini-tts') {
    const style = ttsConfig.voiceStyle.trim();
    payload.instructions =
      style.split(/\s+/).length <= 3
        ? `Speak with a ${style} accent and tone, natural and clearly audible, not subtle.`
        : style;
  }
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ttsConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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

function publicConfig() {
  return {
    cloudVoice: Boolean(ttsConfig.apiKey),
    model: ttsConfig.model,
    voice: ttsConfig.voice,
    rewrite: ttsConfig.rewrite,
    rewriteModel: ttsConfig.rewriteModel,
    narrationSeconds: ttsConfig.narrationSeconds,
    narrationMin: NARRATION_MIN_SECONDS,
    narrationMax: NARRATION_MAX_SECONDS,
    narrationPersona: ttsConfig.narrationPersona,
    voiceStyle: ttsConfig.voiceStyle,
    voiceStyleSupported: ttsConfig.model === 'gpt-4o-mini-tts',
  };
}

// --- http server ------------------------------------------------------

const viewerDir = path.join(__dirname, 'viewer');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

// Binding to 127.0.0.1 (see listen() below) stops other MACHINES, not other
// WEBSITES: a page from any origin can rebind its own hostname's DNS record
// to 127.0.0.1, at which point the browser considers that page same-origin
// with this server, and the X-Fama-Token CSRF defense (which only ever
// assumed a same-origin page could read the token, see requireAuth below)
// is moot, because the rebound page now IS that same-origin page. The Host
// header is the one thing page JS cannot forge, so it's the actual defense:
// found by a security audit, confirmed independently across four separate
// review angles, all converging on this same gap.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

const server = http.createServer((req, res) => {
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden host');
    return;
  }
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // Used to send the full absolute filesystem path here (fine as a tooltip,
    // still a real leak: it showed up in screenshots/demos/streams, and on
    // Windows an absolute path always contains the OS username). Sends only
    // friendly project names now, never a path. An array since one server can
    // now watch several projects at once, see resolveWatchProjects above.
    const detail = watchProjects.length === 1 ? 'Live' : `Live · ${watchProjects.length} projects`;
    res.write(
      `data: ${JSON.stringify({
        kind: 'system',
        label: 'connected',
        detail,
        projects: watchProjects.map((p) => ({ id: p.id, name: p.name })),
      })}\n\n`
    );
    for (const event of backlog) res.write(`data: ${JSON.stringify(event)}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Never echoes ttsConfig.apiKey back, only whether one is set. The browser
  // never needs the real value, and never gets it after Settings saves one.
  if (req.url === '/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(publicConfig()));
    return;
  }

  if (req.url === '/client-error' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    readJsonBody(req)
      .then((body) => {
        console.error(`[client] ${(body && body.message) || 'unknown client error'}`);
        res.writeHead(204);
        res.end();
      })
      .catch(() => {
        res.writeHead(204);
        res.end();
      });
    return;
  }

  if (req.url === '/usage' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(usage));
    return;
  }

  if (req.url === '/usage/reset' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    usage = { totalCost: 0, ttsCalls: 0, ttsChars: 0, rewriteCalls: 0, rewriteTokens: 0, since: new Date().toISOString() };
    saveUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(usage));
    return;
  }

  if (req.url === '/settings' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    readJsonBody(req)
      .then((body) => {
        // Strips interior newlines too, not just leading/trailing whitespace:
        // .trim() alone left a value like "tts-1\nOPENAI_API_KEY=..." able to
        // inject a second line once written to .env. writeDotEnv sanitizes on
        // the way out regardless, this additionally keeps ttsConfig itself
        // (used live for real OpenAI calls) from ever holding one in memory.
        const noNewlines = (s) => s.replace(/[\r\n]+/g, ' ').trim();
        const typedKey = typeof body.apiKey === 'string' ? noNewlines(body.apiKey) : '';
        const model = typeof body.model === 'string' && body.model.trim() ? noNewlines(body.model) : ttsConfig.model;
        const voice = typeof body.voice === 'string' && body.voice.trim() ? noNewlines(body.voice) : ttsConfig.voice;
        const rewriteModel =
          typeof body.rewriteModel === 'string' && body.rewriteModel.trim() ? noNewlines(body.rewriteModel) : ttsConfig.rewriteModel;
        const rewrite = typeof body.rewrite === 'boolean' ? body.rewrite : ttsConfig.rewrite;
        const narrationSeconds =
          body.narrationSeconds !== undefined ? clampNarrationSeconds(body.narrationSeconds) : ttsConfig.narrationSeconds;
        const narrationPersona = typeof body.narrationPersona === 'string' ? body.narrationPersona.trim().slice(0, 500) : ttsConfig.narrationPersona;
        const voiceStyle = typeof body.voiceStyle === 'string' ? body.voiceStyle.trim().slice(0, 500) : ttsConfig.voiceStyle;
        const clearKey = body.clearKey === true;
        // A blank key field means "leave whatever's already saved alone", not
        // "erase it", the only way to actually clear it is the explicit flag.
        const apiKey = clearKey ? '' : typedKey || ttsConfig.apiKey;

        ttsConfig = { apiKey, model, voice, rewriteModel, rewrite, narrationSeconds, narrationPersona, voiceStyle };
        writeDotEnv(ttsConfig);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Object.assign({ ok: true }, publicConfig())));
      })
      .catch(() => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
      });
    return;
  }

  if (req.url === '/speak' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    readJsonBody(req)
      .then(async (body) => {
        const rawText = (body && body.text ? String(body.text) : '').slice(0, MAX_SPEECH_CHARS);
        const kind = typeof body.kind === 'string' ? body.kind : 'text';
        if (!rawText) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'no text' }));
          return;
        }
        if (!ttsConfig.apiKey) {
          res.writeHead(501, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'no OpenAI key configured, use the free browser voice instead' }));
          return;
        }

        let spokenText = rawText;
        let rewriteUsage = null;
        const shouldRewrite = ttsConfig.rewrite && (kind === 'thinking' || kind === 'text');
        if (shouldRewrite) {
          try {
            const result = await rewriteForSpeech(rawText, kind);
            if (result.text) spokenText = result.text;
            rewriteUsage = result;
          } catch (err) {
            // rewrite hiccuped, speak the raw text rather than drop the line
          }
        }

        try {
          console.log(
            `[speak] kind=${kind} chars=${spokenText.length} speed=${body.speed || 1} model=${ttsConfig.model} narrationSeconds=${ttsConfig.narrationSeconds}`
          );
          const audio = await synthesizeSpeech(spokenText, body.speed);
          recordUsage({
            ttsChars: spokenText.length,
            ttsModel: ttsConfig.model,
            rewritePromptTokens: rewriteUsage ? rewriteUsage.promptTokens : 0,
            rewriteCompletionTokens: rewriteUsage ? rewriteUsage.completionTokens : 0,
          });
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': audio.length,
            // Diagnostic only, this header is not what gets synthesized, the
            // full spokenText already went into synthesizeSpeech() above.
            // Sliced only to stay a well-behaved HTTP header, not to truncate
            // the audio, MAX_SPEECH_CHARS (900) is the real ceiling.
            'X-Spoken-Text': encodeURIComponent(spokenText.slice(0, 900)),
          });
          res.end(audio);
        } catch (err) {
          // Found by audit: OpenAI's own error text can embed a masked
          // fragment of the key that was sent (e.g. on an invalid/revoked
          // key). That's fine to log locally, not fine to echo back over
          // the HTTP response, which is visible to devtools/Network tab.
          console.error(`[speak] failed: ${String((err && err.message) || err).slice(0, 300)}`);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'speech synthesis failed, see server log for detail' }));
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
    // index.html gets the auth token injected at serve time, this is the
    // ONLY place it's ever handed out, and only to same-origin page loads,
    // a cross-origin fetch can't read this response body to extract it.
    if (path.basename(filePath) === 'index.html') {
      data = Buffer.from(
        data.toString('utf8').replace('</head>', `<script>window.__FAMA_TOKEN__=${JSON.stringify(AUTH_TOKEN)};</script></head>`)
      );
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// Found by audit: an http.Server with no 'error' listener throws unhandled on
// EADDRINUSE (port already taken, e.g. a second instance), which killed this
// process silently with no console attached in the packaged app, invisible.
server.on('error', (err) => {
  console.error(`[server] failed to start: ${err.message}`);
  process.exitCode = 1;
});

// Bind to loopback only. This feed includes file paths, thinking, and tool
// output, it has no business being reachable from anything else on the LAN.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Fama watching: ${watchProjects.map((p) => `${p.name} (${p.dir})`).join(', ')}`);
  console.log(
    `voice: ${
      ttsConfig.apiKey
        ? `OpenAI (${ttsConfig.model}, ${ttsConfig.voice}), rewrite ${ttsConfig.rewrite ? `on (~${ttsConfig.narrationSeconds}s)` : 'off'}`
        : 'free browser voice (no key configured)'
    }`
  );
  console.log(`open http://localhost:${PORT}`);
});
