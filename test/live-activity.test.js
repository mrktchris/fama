'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LiveActivityIngest, SseEventFeed } = require('../lib/live-activity');

test('SseEventFeed bounds replay and publishes to current subscribers', () => {
  const feed = new SseEventFeed({ maxEvents: 2, maxBytes: 10_000 });
  const live = [];
  const unsubscribe = feed.subscribe({ write: (payload) => live.push(payload) });
  feed.publish({ n: 1 });
  feed.publish({ n: 2 });
  feed.publish({ n: 3 });
  unsubscribe();
  feed.publish({ n: 4 });

  const replay = [];
  feed.replay({ write: (payload) => replay.push(JSON.parse(payload.slice(6))) });
  assert.equal(live.length, 3);
  assert.deepEqual(replay, [{ n: 3 }, { n: 4 }]);
  assert.equal(feed.snapshot().clients, 0);
});

test('Live Activity Ingest starts at EOF and publishes only appended Claude records', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fama-ingest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = path.join(root, 'session.jsonl');
  fs.writeFileSync(session, `${JSON.stringify({ type: 'old' })}\n`, 'utf8');
  const events = [];
  const ingest = new LiveActivityIngest({
    projects: [{ id: 'project-1', dir: root, cwd: root, name: 'Project' }],
    codexSessionsDir: path.join(root, 'missing-codex'),
    parseClaudeRecord: (record) => [{ kind: 'text', detail: record.message }],
    feed: { publish: (event) => events.push(event), snapshot: () => ({}) },
  });

  ingest.scan(Date.now());
  fs.appendFileSync(session, `${JSON.stringify({ message: 'new' })}\n`, 'utf8');
  ingest.poll();
  assert.equal(events.length, 1);
  assert.equal(events[0].detail, 'new');
  assert.equal(events[0].provider, 'claude');
  assert.equal(events[0].projectId, 'project-1');
});

test('Live Activity Ingest filters Codex discovery through Selected Projects', () => {
  const callbacks = [];
  class FakeTailer {
    constructor(_file, callback) {
      callbacks.push(callback);
    }
    poll() {}
  }
  const published = [];
  const project = { id: 'selected', dir: 'missing', cwd: '/selected', name: 'Selected' };
  const ingest = new LiveActivityIngest({
    projects: [project],
    codexSessionsDir: '/codex',
    FileTailer: FakeTailer,
    listCodexSessions: () => [
      { filePath: '/codex/yes.jsonl', cwd: '/selected', sessionId: 'yes', size: 5 },
      { filePath: '/codex/no.jsonl', cwd: '/other', sessionId: 'no', size: 5 },
    ],
    matchProjectForCwd: (_projects, cwd) => (cwd === '/selected' ? project : null),
    parseCodexRecord: (_record, context) => [{ kind: 'text', detail: context.sessionId }],
    feed: { publish: (event) => published.push(event), snapshot: () => ({}) },
  });

  ingest.scan(1001);
  assert.equal(ingest.status().sessions, 1);
  callbacks[0]([{ type: 'event_msg' }]);
  assert.equal(published[0].detail, 'yes');
  assert.equal(published[0].provider, 'codex');
});
