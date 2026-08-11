'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  activeCodexSessions,
  findProjectForCwd,
  isPathInside,
  listJsonlFiles,
  readCodexSessionMeta,
} = require('../lib/codex-paths');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fama-codex-paths-'));
}

function writeSession(root, relativePath, payload) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ timestamp: '2026-08-11T00:00:00Z', type: 'session_meta', payload })}\n`, 'utf8');
  return filePath;
}

test('readCodexSessionMeta: reads the real id/cwd shape from the first JSONL record', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = writeSession(root, path.join('2026', '08', '11', 'rollout-test.jsonl'), {
    id: 'codex-session-1',
    cwd: path.join(root, 'project'),
    base_instructions: 'x'.repeat(80_000),
  });
  assert.deepEqual(readCodexSessionMeta(file), { sessionId: 'codex-session-1', cwd: path.join(root, 'project') });
});

test('activeCodexSessions: recursively finds only recently modified valid transcripts', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = Date.now();
  const active = writeSession(root, path.join('2026', '08', '11', 'active.jsonl'), { id: 'active', cwd: path.join(root, 'a') });
  const stale = writeSession(root, path.join('2026', '06', '25', 'stale.jsonl'), { id: 'stale', cwd: path.join(root, 'b') });
  fs.utimesSync(active, new Date(now), new Date(now));
  fs.utimesSync(stale, new Date(now - 60_000), new Date(now - 60_000));
  fs.writeFileSync(path.join(root, 'not-jsonl.txt'), 'ignored', 'utf8');

  assert.deepEqual(listJsonlFiles(root).sort(), [active, stale].sort());
  const sessions = activeCodexSessions(root, { now, activeWindowMs: 10_000 });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, 'active');
  assert.equal(sessions[0].filePath, active);
});

test('findProjectForCwd: matches only selected roots and prefers the most specific root', () => {
  const root = path.resolve('CWD-root');
  const child = path.join(root, 'child');
  const projects = [
    { id: 'root', cwd: root },
    { id: 'child', cwd: child },
  ];
  assert.equal(isPathInside(root, path.join(child, 'src')), true);
  assert.equal(isPathInside(child, root), false);
  assert.equal(findProjectForCwd(projects, path.join(child, 'src')).id, 'child');
  assert.equal(findProjectForCwd(projects, path.resolve('unrelated')), null);
});
