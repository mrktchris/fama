'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileTailer } = require('../lib/tail');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fama-tail-test-'));
  return path.join(dir, 'transcript.jsonl');
}

test('FileTailer: only reads what was appended since the last poll (does not re-read from start)', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ a: 1 }) + '\n');
  const seen = [];
  const tailer = new FileTailer(file, (records) => seen.push(...records));
  tailer.offset = fs.statSync(file).size; // seed at EOF, matches how server.js starts a fresh tailer
  tailer.poll();
  assert.deepEqual(seen, [], 'seeding at EOF should not replay pre-existing content');

  fs.appendFileSync(file, JSON.stringify({ a: 2 }) + '\n');
  tailer.poll();
  assert.deepEqual(seen, [{ a: 2 }]);
});

test('FileTailer: holds back an incomplete trailing line until it is completed', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '');
  const seen = [];
  const tailer = new FileTailer(file, (records) => seen.push(...records));

  fs.appendFileSync(file, '{"partial": tr'); // deliberately incomplete JSON, no trailing newline
  tailer.poll();
  assert.deepEqual(seen, [], 'an incomplete line should not be parsed or emitted yet');

  fs.appendFileSync(file, 'ue}\n');
  tailer.poll();
  assert.deepEqual(seen, [{ partial: true }]);
});

test('FileTailer: skips corrupt/non-JSON lines instead of throwing', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '');
  const seen = [];
  const tailer = new FileTailer(file, (records) => seen.push(...records));

  fs.appendFileSync(file, 'not json at all\n' + JSON.stringify({ ok: 1 }) + '\n');
  assert.doesNotThrow(() => tailer.poll());
  assert.deepEqual(seen, [{ ok: 1 }], 'the corrupt line should be skipped, the valid one after it still processed');
});

test('FileTailer: does not corrupt a multi-byte UTF-8 character split across two polls', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '');
  const seen = [];
  const tailer = new FileTailer(file, (records) => seen.push(...records));

  const line = JSON.stringify({ text: '🎉 emoji test café' });
  const buf = Buffer.from(line + '\n', 'utf8');
  // Split the buffer mid-character on purpose: write the first half, poll,
  // then the second half, poll again. A naive buf.toString('utf8') per chunk
  // would mangle whichever multi-byte character straddles the split.
  const splitPoint = Math.floor(buf.length / 2);
  fs.appendFileSync(file, buf.subarray(0, splitPoint));
  tailer.poll();
  fs.appendFileSync(file, buf.subarray(splitPoint));
  tailer.poll();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, '🎉 emoji test café');
});

test('FileTailer: restarts cleanly if the file shrinks (truncated/rotated) instead of throwing', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ aLongerRecordToStart: 12345 }) + '\n');
  const seen = [];
  const tailer = new FileTailer(file, (records) => seen.push(...records));
  tailer.poll();
  assert.deepEqual(seen, [{ aLongerRecordToStart: 12345 }]);

  // Genuinely shorter in bytes than what came before, not just different
  // content, this is what actually triggers the tailer's truncation branch
  // (stat.size < this.offset). Two same-length payloads would silently
  // never exercise that path at all, which is exactly the mistake this
  // test had on its first pass, caught by actually running it, not just
  // reading the code and assuming it was right.
  fs.writeFileSync(file, JSON.stringify({ b: 2 }) + '\n');
  assert.doesNotThrow(() => tailer.poll());
  assert.deepEqual(seen, [{ aLongerRecordToStart: 12345 }, { b: 2 }], 'should pick up the new content after resetting, not crash or hang');
});
