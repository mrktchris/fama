'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMINICAN_ENGLISH_STYLE, voiceStyleInstructions } = require('../lib/voice-style');

test('Dominican labels expand into the full respectful voice-design prompt', () => {
  for (const label of ['Dominican', 'dominican english', 'Dominican-American']) {
    assert.equal(voiceStyleInstructions(label), DOMINICAN_ENGLISH_STYLE);
  }
  assert.match(DOMINICAN_ENGLISH_STYLE, /Dominican-American English/);
  assert.match(DOMINICAN_ENGLISH_STYLE, /never exaggerated, comedic, or stereotyped/);
});

test('other short labels expand and authored prompts pass through unchanged', () => {
  assert.equal(
    voiceStyleInstructions('calm British'),
    'Speak with a calm British accent and tone, natural and clearly audible, not subtle.'
  );
  const authored = 'Warm, upbeat, energetic delivery with a deliberate pace';
  assert.equal(voiceStyleInstructions(authored), authored);
  assert.equal(voiceStyleInstructions('   '), '');
});
