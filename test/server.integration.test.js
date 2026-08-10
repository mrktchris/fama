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

before(async () => {
  // Empty temp dir as the watch target, this test cares about the HTTP
  // surface, not real transcript content.
  const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fama-server-test-'));
  serverProcess = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      CLAUDE_NARRATOR_DIR: watchDir,
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

test('static file serving rejects path traversal', async () => {
  const res = await request('/../../../../etc/passwd');
  assert.notEqual(res.status, 200);
});
