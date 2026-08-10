'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { eventsFromRecord } = require('../lib/parse');

function assistantRecord(content) {
  return { type: 'assistant', sessionId: 's1', timestamp: 't1', uuid: 'u1', message: { content } };
}
function userRecord(content) {
  return { type: 'user', sessionId: 's1', timestamp: 't1', uuid: 'u1', message: { content } };
}

test('eventsFromRecord: ignores non-user/assistant record types', () => {
  assert.deepEqual(eventsFromRecord({ type: 'queue-operation' }), []);
  assert.deepEqual(eventsFromRecord(null), []);
  assert.deepEqual(eventsFromRecord({}), []);
});

test('eventsFromRecord: plain string user message becomes a prompt event', () => {
  const events = eventsFromRecord(userRecord('hello there'));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'prompt');
  assert.equal(events[0].detail, 'hello there');
});

test('eventsFromRecord: blank string user message produces no event', () => {
  assert.deepEqual(eventsFromRecord(userRecord('   ')), []);
});

test('eventsFromRecord: assistant text block is not truncated', () => {
  const long = 'x'.repeat(500);
  const events = eventsFromRecord(assistantRecord([{ type: 'text', text: long }]));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'text');
  assert.equal(events[0].detail, long);
});

test('eventsFromRecord: thinking block over 220 chars has a truncated display detail and a fuller "full" field', () => {
  const long = 'a'.repeat(500);
  const events = eventsFromRecord(assistantRecord([{ type: 'thinking', thinking: long }]));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'thinking');
  // detail is capped ~220 chars (plus the truncation ellipsis)
  assert.ok(events[0].detail.length <= 222, `detail should be truncated, was ${events[0].detail.length} chars`);
  // full carries much more of the original text through to the rewrite step
  assert.ok(events[0].full.length > events[0].detail.length, 'full should be longer than the truncated display detail');
  assert.ok(events[0].full.length >= 500, 'full should not itself be aggressively truncated for a 500-char block');
});

test('eventsFromRecord: short thinking block is not truncated in either field', () => {
  const short = 'a short thought';
  const events = eventsFromRecord(assistantRecord([{ type: 'thinking', thinking: short }]));
  assert.equal(events[0].detail, short);
  assert.equal(events[0].full, short);
});

test('eventsFromRecord: tool_use becomes a tool event with the tool name as label', () => {
  const events = eventsFromRecord(assistantRecord([{ type: 'tool_use', name: 'Read', input: { file_path: '/a/b.txt' } }]));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'tool');
  assert.equal(events[0].label, 'Read');
  assert.equal(events[0].detail, '/a/b.txt');
});

test('eventsFromRecord: tool_result with is_error becomes an error event', () => {
  const events = eventsFromRecord(userRecord([{ type: 'tool_result', is_error: true, content: 'boom' }]));
  assert.equal(events[0].kind, 'error');
  assert.equal(events[0].label, 'error');
});

test('eventsFromRecord: tool_result without is_error becomes a result event', () => {
  const events = eventsFromRecord(userRecord([{ type: 'tool_result', content: 'ok' }]));
  assert.equal(events[0].kind, 'result');
  assert.equal(events[0].label, 'done');
});

test('eventsFromRecord: image block becomes an image event', () => {
  const events = eventsFromRecord(assistantRecord([{ type: 'image' }]));
  assert.equal(events[0].kind, 'image');
});

test('eventsFromRecord: unknown block types are ignored, not thrown on', () => {
  assert.doesNotThrow(() => eventsFromRecord(assistantRecord([{ type: 'something_new_and_unhandled' }])));
  assert.deepEqual(eventsFromRecord(assistantRecord([{ type: 'something_new_and_unhandled' }])), []);
});

test('eventsFromRecord: malformed content (not array or string) does not throw', () => {
  assert.doesNotThrow(() => eventsFromRecord(assistantRecord(42)));
  assert.doesNotThrow(() => eventsFromRecord(assistantRecord(null)));
});
