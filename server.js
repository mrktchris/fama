#!/usr/bin/env node
'use strict';

/**
 * Fama
 * Local live viewer for Claude Code and Codex activity. Tails the JSONL
 * session transcripts both agents already write on disk and streams their
 * normalized events to a browser over Server-Sent Events.
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
const { redactSensitiveText } = require('./lib/redact');
const { CloudNarration, CloudNarrationError } = require('./lib/cloud-narration');
const { LiveActivityIngest } = require('./lib/live-activity');
const { selectedProjectsFromEnvironment } = require('./lib/selected-projects');

// A fresh random token per process, required as a header on every route that
// mutates anything or spends money. Not persisted anywhere, not needed to be:
// it only has to prove the caller is the actual page this server just served,
// not some other tab/site. Delivered by a same-origin, no-store /auth.js
// response before the application scripts load, so only same-
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
const { encodeProjectDir, claudeProjectsRoot } = require('./lib/paths');
const { codexSessionsRoot } = require('./lib/codex-paths');

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
const cloudNarration = new CloudNarration({ envPath: ENV_PATH, usagePath: USAGE_PATH, env: process.env });
const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;
const ACTIVE_WINDOW_MS = 15 * 60 * 1000; // a session file counts as "active" if touched in the last 15 min
const POLL_MS = 250; // how often we check transcripts for new lines, kept tight on purpose, see README

function resolveWatchDir() {
  if (process.env.CLAUDE_NARRATOR_DIR) return process.env.CLAUDE_NARRATOR_DIR;
  const encoded = encodeProjectDir(process.cwd());
  return path.join(claudeProjectsRoot(), encoded);
}

function resolveWatchProjects() {
  return selectedProjectsFromEnvironment(process.env, {
    dir: resolveWatchDir(),
    cwd: process.env.FAMA_PROJECT_CWD || process.cwd(),
    name: process.env.FAMA_PROJECT_LABEL || path.basename(process.cwd()),
  });
}

const watchProjects = resolveWatchProjects();
const CODEX_DISCOVERY_MS = 1000;
const CODEX_SESSIONS_DIR = process.env.FAMA_CODEX_SESSIONS_DIR || codexSessionsRoot();
const liveActivity = new LiveActivityIngest({
  projects: watchProjects,
  codexSessionsDir: CODEX_SESSIONS_DIR,
  activeWindowMs: ACTIVE_WINDOW_MS,
  codexDiscoveryMs: CODEX_DISCOVERY_MS,
  pollMs: POLL_MS,
});
liveActivity.start();

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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

function applySecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=(), serial=()');
}

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
  applySecurityHeaders(res);
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden host');
    return;
  }
  let requestPath;
  try {
    requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('bad request');
    return;
  }

  if (requestPath === '/events' && req.method === 'GET') {
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
    const unsubscribe = liveActivity.subscribe(res);
    req.on('close', unsubscribe);
    return;
  }

  // The Cloud Narration Interface exposes only whether a key exists; the raw
  // credential never crosses into the browser.
  if (requestPath === '/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cloudNarration.publicConfig()));
    return;
  }

  if (requestPath === '/client-error' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    readJsonBody(req)
      .then((body) => {
        const message = redactSensitiveText((body && body.message) || 'unknown client error').replace(/[\r\n]+/g, ' ').slice(0, 500);
        console.error(`[client] ${message}`);
        res.writeHead(204);
        res.end();
      })
      .catch(() => {
        res.writeHead(204);
        res.end();
      });
    return;
  }

  if (requestPath === '/usage' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cloudNarration.usage()));
    return;
  }

  if (requestPath === '/usage/reset' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    const usage = cloudNarration.resetUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(usage));
    return;
  }

  if (requestPath === '/settings' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    readJsonBody(req)
      .then((body) => {
        const config = cloudNarration.updateSettings(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Object.assign({ ok: true }, config)));
      })
      .catch(() => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
      });
    return;
  }

  if (requestPath === '/speak' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    readJsonBody(req)
      .then(async (body) => {
        try {
          const result = await cloudNarration.speak(body || {});
          console.log(
            `[speak] kind=${result.kind} chars=${result.spokenText.length} speed=${result.speed} model=${result.model} narrationSeconds=${result.narrationSeconds}`
          );
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': result.audio.length,
          });
          res.end(result.audio);
        } catch (err) {
          const known = err instanceof CloudNarrationError;
          if (!known || err.status >= 500) console.error(`[speak] failed: ${cloudNarration.providerErrorMessage(err)}`);
          res.writeHead(known ? err.status : 502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: known ? err.publicMessage : 'speech synthesis failed, see server log for detail' }));
        }
      })
      .catch(() => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
      });
    return;
  }

  if (requestPath === '/auth.js' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    res.end(`window.__FAMA_TOKEN__=${JSON.stringify(AUTH_TOKEN)};`);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' });
    res.end('method not allowed');
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath).replace(/\\/g, '/');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('bad path');
    return;
  }
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(viewerDir, relativePath);
  const relativeToViewer = path.relative(viewerDir, filePath);
  if (relativeToViewer === '..' || relativeToViewer.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToViewer)) {
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
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (path.basename(filePath) === 'index.html') headers['Cache-Control'] = 'no-store';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
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
  console.log(`voice: ${cloudNarration.describe()}`);
  console.log(`open http://localhost:${PORT}`);
});
