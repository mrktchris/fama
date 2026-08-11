'use strict';

// Integration smoke test: spawns the real server.js as a subprocess and
// exercises it over real HTTP, same shape of check done by hand throughout
// this project's development (and by the external audit that reviewed it),
// now codified so it doesn't rely on remembering to do it manually again.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stableProjectId } = require('../lib/selected-projects');

let port;
let serverProcess;
let authToken;
let watchDir;
let claudeSessionFile;
let codexSessionFile;

function request(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: options.host || '127.0.0.1',
        port,
        path: urlPath,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function reserveEphemeralPort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForServer(attemptsLeft) {
  try {
    await request('/');
  } catch {
    if (attemptsLeft <= 0) throw new Error('server never came up');
    await new Promise((r) => setTimeout(r, 300));
    return waitForServer(attemptsLeft - 1);
  }
}

function waitForSseEvent(predicate, trigger) {
  return new Promise((resolve, reject) => {
    let response;
    let buffer = '';
    let triggered = false;
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('timed out waiting for SSE event'));
    }, 5000);
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/events', method: 'GET' },
      (res) => {
        response = res;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (!frame.startsWith('data: ')) continue;
            let event;
            try {
              event = JSON.parse(frame.slice(6));
            } catch {
              continue;
            }
            if (!triggered && event.kind === 'system') {
              triggered = true;
              trigger();
            }
            if (predicate(event)) {
              clearTimeout(timer);
              req.destroy();
              if (response) response.destroy();
              resolve(event);
              return;
            }
          }
        });
      }
    );
    req.on('error', (err) => {
      if (err.code === 'ECONNRESET' && triggered) return;
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

before(async () => {
  // Empty temp dir as the watch target, this test cares about the HTTP
  // surface, not real transcript content.
  watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fama-server-test-'));
  claudeSessionFile = path.join(watchDir, 'claude-session.jsonl');
  fs.writeFileSync(claudeSessionFile, `${JSON.stringify({ type: 'queue-operation' })}\n`, 'utf8');
  const codexSessionsDir = path.join(watchDir, 'codex-sessions');
  fs.mkdirSync(codexSessionsDir, { recursive: true });
  codexSessionFile = path.join(codexSessionsDir, 'rollout-test.jsonl');
  fs.writeFileSync(
    codexSessionFile,
    `${JSON.stringify({ timestamp: '2026-08-11T00:00:00Z', type: 'session_meta', payload: { id: 'codex-live-test', cwd: watchDir } })}\n`,
    'utf8'
  );
  // A fixed test port made concurrent Claude/Codex audits interfere: one run
  // could connect to a stale child while its own server exited on EADDRINUSE.
  // Reserve an OS-selected port per process, then wait for teardown below.
  port = await reserveEphemeralPort();
  serverProcess = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port),
      CLAUDE_NARRATOR_DIR: watchDir,
      FAMA_PROJECT_CWD: watchDir,
      FAMA_PROJECT_LABEL: 'integration-project',
      FAMA_CODEX_SESSIONS_DIR: codexSessionsDir,
      FAMA_ENV_PATH: path.join(watchDir, '.env'), // isolated, never touches a real .env
      FAMA_USAGE_PATH: path.join(watchDir, 'usage.json'),
    }),
  });
  await waitForServer(20);
  const auth = await request('/auth.js');
  const match = auth.body.match(/__FAMA_TOKEN__="([^"]+)"/);
  assert.ok(match, 'same-origin auth.js should provide the per-process token');
  authToken = match[1];
});

after(async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  await new Promise((resolve) => {
    serverProcess.once('exit', resolve);
    serverProcess.kill();
  });
});

test('legitimate Host header: / returns 200', async () => {
  const res = await request('/', { headers: { Host: `127.0.0.1:${port}` } });
  assert.equal(res.status, 200);
});

test('responses include browser hardening headers and auth.js is never cached', async () => {
  const home = await request('/');
  assert.match(home.headers['content-security-policy'], /default-src 'self'/);
  assert.match(home.headers['content-security-policy'], /object-src 'none'/);
  assert.doesNotMatch(home.headers['content-security-policy'], /unsafe-inline/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.equal(home.headers['x-frame-options'], 'DENY');
  assert.equal(home.headers['referrer-policy'], 'no-referrer');
  assert.equal(home.headers['cache-control'], 'no-store');
  assert.equal(home.body.includes('__FAMA_TOKEN__='), false, 'index HTML must remain static under CSP');
  assert.equal(/\sstyle=/.test(home.body), false, 'viewer HTML must not require inline styles');
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'viewer', 'settings.js'), 'utf8').includes('.style.'), false);
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'viewer', 'app.js'), 'utf8').includes('.style.'), false);
  const auth = await request('/auth.js');
  assert.equal(auth.headers['cache-control'], 'no-store');
});

test('spoofed Host header: every route returns 403, including /events', async () => {
  const spoofedHeaders = { headers: { Host: 'attacker.example.com' } };
  const root = await request('/', spoofedHeaders);
  assert.equal(root.status, 403);
  const events = await request('/events', spoofedHeaders);
  assert.equal(events.status, 403);
  const config = await request('/config', spoofedHeaders);
  assert.equal(config.status, 403);
});

test('mutating route without a token: 403', async () => {
  const res = await request('/usage/reset', { method: 'POST' });
  assert.equal(res.status, 403);
});

test('mutating route with the real token: 200', async () => {
  const res = await request('/usage/reset', { method: 'POST', headers: { 'X-Fama-Token': authToken } });
  assert.equal(res.status, 200);
});

test('mutating route with a wrong token: 403, not 200', async () => {
  const res = await request('/usage/reset', { method: 'POST', headers: { 'X-Fama-Token': 'not-the-real-token' } });
  assert.equal(res.status, 403);
});

test('/config never echoes the real API key, only whether one is set', async () => {
  const res = await request('/config');
  assert.equal(res.status, 200);
  const cfg = JSON.parse(res.body);
  assert.equal(typeof cfg.cloudVoice, 'boolean');
  assert.ok(!('apiKey' in cfg), '/config response must never include the raw key field');
  assert.ok(!res.body.includes('sk-'), '/config response body must never contain anything key-shaped');
});

test('/events tags new Claude activity with its provider and selected project', async () => {
  const event = await waitForSseEvent(
    (candidate) => candidate.provider === 'claude' && candidate.detail === 'hello from claude',
    () => {
      fs.appendFileSync(
        claudeSessionFile,
        `${JSON.stringify({
          type: 'assistant',
          sessionId: 'claude-live-test',
          timestamp: '2026-08-11T00:00:01Z',
          message: { content: [{ type: 'text', text: 'hello from claude' }] },
        })}\n`,
        'utf8'
      );
    }
  );
  assert.equal(event.sessionId, 'claude-live-test');
  assert.equal(event.projectId, stableProjectId(watchDir, watchDir));
  assert.equal(event.projectName, 'integration-project');
});

test('/events tails Codex activity and preserves its session/project identity', async () => {
  const event = await waitForSseEvent(
    (candidate) => candidate.provider === 'codex' && candidate.detail === 'hello from codex',
    () => {
      fs.appendFileSync(
        codexSessionFile,
        `${JSON.stringify({
          timestamp: '2026-08-11T00:00:02Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'hello from codex' },
        })}\n`,
        'utf8'
      );
    }
  );
  assert.equal(event.sessionId, 'codex-live-test');
  assert.equal(event.projectId, stableProjectId(watchDir, watchDir));
  assert.equal(event.projectName, 'integration-project');
});

test('static file serving rejects path traversal', async () => {
  for (const attempt of ['/../../../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%5c..%5cWindows%5cwin.ini']) {
    const res = await request(attempt);
    assert.notEqual(res.status, 200, attempt);
  }
  const encoded = await request('/..%2f..%2f..%2fetc%2fpasswd');
  assert.equal(encoded.status, 403);
});

test('static files support query strings and reject non-read methods', async () => {
  const withQuery = await request('/index.html?cache-bust=1');
  assert.equal(withQuery.status, 200);
  const post = await request('/style.css', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});
