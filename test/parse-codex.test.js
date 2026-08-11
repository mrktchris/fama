'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { eventsFromCodexRecord, summarizeToolArguments, textFromReasoningSummary } = require('../lib/parse-codex');

// Every fixture below mirrors the exact field shapes found in a real
// ~/.codex/sessions/*/rollout-*.jsonl file, inspected 2026-08-11 (see
// FAMA-BIG-ROLLOUT-PLAN.md), not invented from the public API docs alone.

test('eventsFromCodexRecord: ignores unknown top-level types', () => {
  assert.deepEqual(eventsFromCodexRecord({ type: 'turn_context', payload: {} }), []);
  assert.deepEqual(eventsFromCodexRecord({ type: 'session_meta', payload: { session_id: 's1' } }), []);
});

test('eventsFromCodexRecord: malformed/missing payload does not throw', () => {
  assert.doesNotThrow(() => eventsFromCodexRecord(null));
  assert.doesNotThrow(() => eventsFromCodexRecord({}));
  assert.doesNotThrow(() => eventsFromCodexRecord({ type: 'event_msg' }));
});

test('eventsFromCodexRecord: user_message becomes a prompt event', () => {
  const events = eventsFromCodexRecord(
    { type: 'event_msg', timestamp: 't1', payload: { type: 'user_message', message: 'fix the dashboard', turn_id: 'turn1' } },
    { sessionId: 's1' }
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'prompt');
  assert.equal(events[0].detail, 'fix the dashboard');
  assert.equal(events[0].sessionId, 's1');
  assert.equal(events[0].provider, 'codex');
});

test('eventsFromCodexRecord: agent_message becomes a text event', () => {
  const events = eventsFromCodexRecord(
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Checking the Meta MCP config.', phase: 'commentary' } },
    { sessionId: 's1' }
  );
  assert.equal(events[0].kind, 'text');
  assert.equal(events[0].label, 'codex');
});

test('eventsFromCodexRecord: blank agent_message produces no event', () => {
  const events = eventsFromCodexRecord({ type: 'event_msg', payload: { type: 'agent_message', message: '  ' } }, {});
  assert.deepEqual(events, []);
});

test('eventsFromCodexRecord: task_complete becomes a result event', () => {
  const events = eventsFromCodexRecord(
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn1', last_agent_message: 'Done, corrected the config.' } },
    { sessionId: 's1' }
  );
  assert.equal(events[0].kind, 'result');
  assert.equal(events[0].label, 'done');
});

test('eventsFromCodexRecord: task_started/token_count/web_search_end are not narration-worthy on their own', () => {
  assert.deepEqual(eventsFromCodexRecord({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } }, {}), []);
  assert.deepEqual(eventsFromCodexRecord({ type: 'event_msg', payload: { type: 'token_count' } }, {}), []);
  assert.deepEqual(eventsFromCodexRecord({ type: 'event_msg', payload: { type: 'web_search_end' } }, {}), []);
});

test('eventsFromCodexRecord: reasoning with an empty summary produces no thinking event (the common real-world case)', () => {
  const events = eventsFromCodexRecord(
    { type: 'response_item', payload: { type: 'reasoning', id: 'rs1', summary: [], encrypted_content: 'gAAAAA...' } },
    { sessionId: 's1' }
  );
  assert.deepEqual(events, []);
});

test('eventsFromCodexRecord: reasoning with a populated summary becomes a thinking event', () => {
  const events = eventsFromCodexRecord(
    { type: 'response_item', payload: { type: 'reasoning', id: 'rs1', summary: [{ type: 'summary_text', text: 'Considering two approaches.' }] } },
    { sessionId: 's1' }
  );
  assert.equal(events[0].kind, 'thinking');
  assert.equal(events[0].detail, 'Considering two approaches.');
});

test('eventsFromCodexRecord: function_call becomes a tool event, JSON string arguments parsed', () => {
  const events = eventsFromCodexRecord(
    { type: 'response_item', payload: { type: 'function_call', id: 'fc1', name: 'shell', arguments: '{"command":"npm test"}', call_id: 'call1' } },
    { sessionId: 's1' }
  );
  assert.equal(events[0].kind, 'tool');
  assert.equal(events[0].label, 'shell');
  assert.equal(events[0].detail, 'npm test');
});

test('eventsFromCodexRecord: function_call with malformed JSON arguments does not throw', () => {
  const events = eventsFromCodexRecord(
    { type: 'response_item', payload: { type: 'function_call', name: 'weird_tool', arguments: 'not json{{', call_id: 'call1' } },
    { sessionId: 's1' }
  );
  assert.equal(events[0].kind, 'tool');
});

test('eventsFromCodexRecord: function_call_output becomes a result event', () => {
  const events = eventsFromCodexRecord(
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call1', output: '{"tools":["a","b"]}' } },
    { sessionId: 's1' }
  );
  assert.equal(events[0].kind, 'result');
  assert.equal(events[0].label, 'done');
});

test('eventsFromCodexRecord: response_item message (developer/user/assistant) is deliberately skipped, avoids double-narration', () => {
  assert.deepEqual(
    eventsFromCodexRecord({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'huge system prompt' }] } }, {}),
    []
  );
  assert.deepEqual(
    eventsFromCodexRecord({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'dup of agent_message' }] } }, {}),
    []
  );
});

test('summarizeToolArguments: prefers command, falls back to first key', () => {
  assert.equal(summarizeToolArguments('{"command":"npm run build"}'), 'npm run build');
  assert.equal(summarizeToolArguments('{"file_path":"src/x.ts"}'), 'src/x.ts');
  assert.equal(summarizeToolArguments('{"weird":"value"}'), 'weird: value');
  assert.equal(summarizeToolArguments('{}'), '');
});

test('textFromReasoningSummary: joins multiple summary text items, handles string/object shapes', () => {
  assert.equal(textFromReasoningSummary([]), '');
  assert.equal(textFromReasoningSummary(null), '');
  assert.equal(textFromReasoningSummary(['a plain string']), 'a plain string');
  assert.equal(textFromReasoningSummary([{ text: 'first' }, { summary_text: 'second' }]), 'first second');
});
