'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactSensitiveText } = require('../lib/redact');

test('redactSensitiveText removes common credentials before cloud narration', () => {
  const input = [
    `OpenAI sk-${'a'.repeat(24)}`,
    `GitHub github_pat_${'b'.repeat(24)}`,
    `AWS AKIA${'C'.repeat(16)}`,
    `Google AIza${'d'.repeat(31)}`,
  ].join(' | ');
  const output = redactSensitiveText(input);
  assert.equal(output.includes('sk-'), false);
  assert.equal(output.includes('github_pat_'), false);
  assert.equal(output.includes('AKIA'), false);
  assert.equal(output.includes('AIza'), false);
  assert.equal((output.match(/\[redacted credential\]/g) || []).length, 4);
});

test('redactSensitiveText removes complete private-key blocks and preserves normal text', () => {
  const input = 'before\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\nafter';
  assert.equal(redactSensitiveText(input), 'before\n[redacted credential]\nafter');
  assert.equal(redactSensitiveText('ordinary narration'), 'ordinary narration');
});
