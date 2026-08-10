'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeProjectDir } = require('../lib/paths');

test('encodeProjectDir: Windows drive-letter path', () => {
  assert.equal(encodeProjectDir('C:\\Users\\User\\Documents\\Claude'), 'C--Users-User-Documents-Claude');
});

test('encodeProjectDir: Windows path with different drive letter', () => {
  assert.equal(encodeProjectDir('D:\\Projects\\thing'), 'D--Projects-thing');
});

test('encodeProjectDir: Unix absolute path', () => {
  assert.equal(encodeProjectDir('/Users/name/project'), '-Users-name-project');
});

test('encodeProjectDir: Unix path with multiple segments', () => {
  assert.equal(encodeProjectDir('/home/user/code/my-app'), '-home-user-code-my-app');
});

test('encodeProjectDir: does not mangle a Windows path with hyphens already in it', () => {
  assert.equal(encodeProjectDir('C:\\Users\\User\\my-project'), 'C--Users-User-my-project');
});
