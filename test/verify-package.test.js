'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const VERIFY_SCRIPT = path.join(__dirname, '..', 'desktop', 'verify-package.js');

function packageFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fama-verify-package-'));
  const app = path.join(root, 'Fama-win32-x64', 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, app };
}

function verify(root) {
  return spawnSync(process.execPath, [VERIFY_SCRIPT, root], { encoding: 'utf8' });
}

test('package verifier scans secrets beyond the old two-megabyte ceiling', (t) => {
  const { root, app } = packageFixture(t);
  const fakeKey = 'sk-' + 'A'.repeat(32);
  fs.writeFileSync(path.join(app, 'large.txt'), 'safe\n'.repeat(450_000) + fakeKey);

  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SECRET \(OpenAI API key\)/);
  assert.doesNotMatch(result.stderr, new RegExp(fakeKey));
});

test('package verifier catches forbidden nested directory paths', (t) => {
  const { root, app } = packageFixture(t);
  const cache = path.join(app, 'node_modules', '.cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'marker'), 'build cache');

  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FORBIDDEN DIRECTORY/);
});

test('package verifier accepts a clean large text artifact', (t) => {
  const { root, app } = packageFixture(t);
  fs.writeFileSync(path.join(app, 'large.txt'), 'safe\n'.repeat(450_000));

  const result = verify(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no secrets or forbidden files found/);
});

test('package verifier does not interpret an extensionless platform binary as UTF-8 text', (t) => {
  const { root } = packageFixture(t);
  const executable = path.join(root, 'Fama-win32-x64', 'fama');
  const coincidentalBytes = Buffer.from(`\u007fELF\0random-sk-${'A'.repeat(32)}-bytes\0`, 'utf8');
  fs.writeFileSync(executable, coincidentalBytes);

  const result = verify(root);
  assert.equal(result.status, 0, result.stderr);
});

test('package verifier still scans an ASAR archive for embedded secrets', (t) => {
  const { root, app } = packageFixture(t);
  const resources = path.dirname(app);
  fs.writeFileSync(path.join(resources, 'app.asar'), `archive-content-sk-${'A'.repeat(32)}`);

  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SECRET \(OpenAI API key\)/);
});
