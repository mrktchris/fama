'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { eventsFromBuzzHeartbeat } = require('../lib/parse-buzz-heartbeat');

test('normalizes a sanitized BUZZ heartbeat without carrying client scope', () => {
  const [event] = eventsFromBuzzHeartbeat({
    type: 'agent_heartbeat',
    timestamp: '2026-08-11T22:55:00Z',
    persona: 'max',
    code: 'THROTTLE',
    status: 'watching',
    client_summary: 'Pacing is inside the approved guardrail.',
    trace_id: 'trace-1',
    client_scope: 'must-not-cross-the-adapter',
  });
  assert.deepEqual(event, {
    sessionId: 'buzz-frac7-max',
    ts: '2026-08-11T22:55:00Z',
    provider: 'buzz',
    kind: 'agent_heartbeat',
    label: 'max · THROTTLE',
    detail: 'Pacing is inside the approved guardrail.',
    status: 'watching',
    agent: 'max',
    uuid: 'trace-1',
  });
});

test('rejects unattributed, unknown, invalid, and oversized heartbeats', () => {
  const valid = {
    type: 'agent_heartbeat',
    timestamp: '2026-08-11T22:55:00Z',
    persona: 'vera',
    code: 'LEDGER',
    status: 'ready',
    client_summary: 'Verified.',
  };
  assert.deepEqual(eventsFromBuzzHeartbeat({ ...valid, timestamp: null }), []);
  assert.deepEqual(eventsFromBuzzHeartbeat({ ...valid, timestamp: 'not-a-date' }), []);
  assert.deepEqual(eventsFromBuzzHeartbeat({ ...valid, persona: 'other-client-agent' }), []);
  assert.deepEqual(eventsFromBuzzHeartbeat({ ...valid, status: 'publishing' }), []);
  assert.deepEqual(eventsFromBuzzHeartbeat({ ...valid, client_summary: 'x'.repeat(241) }), []);
  assert.deepEqual(eventsFromBuzzHeartbeat({ ...valid, type: 'chat_message' }), []);
});
