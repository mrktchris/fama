'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { encodeProjectDir, projectDirFromEncoded } = require('../lib/paths');

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

test('projectDirFromEncoded accepts one directory name and rejects traversal', () => {
  const root = path.resolve('test-project-root');
  assert.equal(projectDirFromEncoded('C--Users-User-project', root), path.join(root, 'C--Users-User-project'));
  for (const unsafe of ['', '.', '..', '../secret', '..\\secret', 'nested/project', 'nested\\project']) {
    assert.equal(projectDirFromEncoded(unsafe, root), null, `${unsafe || '<empty>'} must be rejected`);
  }
});
