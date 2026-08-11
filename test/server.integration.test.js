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

const PORT = 4399; // distinct from the real app's 4317, avoids colliding with a running instance
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
        port: PORT,
        path: urlPath,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
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
      { hostname: '127.0.0.1', port: PORT, path: '/events', method: 'GET' },
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
  serverProcess = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      CLAUDE_NARRATOR_DIR: watchDir,
      FAMA_PROJECT_CWD: watchDir,
      FAMA_PROJECT_LABEL: 'integration-project',
      FAMA_CODEX_SESSIONS_DIR: codexSessionsDir,
      FAMA_ENV_PATH: path.join(watchDir, '.env'), // isolated, never touches a real .env
      FAMA_USAGE_PATH: path.join(watchDir, 'usage.json'),
    }),
  });
  await waitForServer(20);
  const home = await request('/');
  const match = home.body.match(/__FAMA_TOKEN__="([^"]+)"/);
  assert.ok(match, 'served index.html should inject the auth token');
  authToken = match[1];
});

after(() => {
  if (serverProcess) serverProcess.kill();
});

test('legitimate Host header: / returns 200', async () => {
  const res = await request('/', { headers: { Host: `127.0.0.1:${PORT}` } });
  assert.equal(res.status, 200);
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
  assert.equal(event.projectId, '0');
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
  assert.equal(event.projectId, '0');
  assert.equal(event.projectName, 'integration-project');
});

test('static file serving rejects path traversal', async () => {
  const res = await request('/../../../../etc/passwd');
  assert.notEqual(res.status, 200);
});
