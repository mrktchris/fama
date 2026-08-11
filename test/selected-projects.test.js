'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  encodedSelectionFromConfig,
  selectedProjectsEnvironment,
  selectedProjectsFromEncoded,
  selectedProjectsFromEnvironment,
  selectedProjectsFromSelection,
  stableProjectId,
} = require('../lib/selected-projects');

test('Selected Project ids are stable across selection ordering', () => {
  const a = path.resolve('project-a');
  const b = path.resolve('project-b');
  const first = selectedProjectsFromEnvironment(
    { FAMA_SELECTED_PROJECTS: JSON.stringify([{ dir: `${a}-logs`, cwd: a }, { dir: `${b}-logs`, cwd: b }]) },
    {}
  );
  const reordered = selectedProjectsFromEnvironment(
    { FAMA_SELECTED_PROJECTS: JSON.stringify([{ dir: `${b}-logs`, cwd: b }, { dir: `${a}-logs`, cwd: a }]) },
    {}
  );
  assert.equal(first[0].id, stableProjectId(a, `${a}-logs`));
  assert.equal(first[0].id, reordered[1].id);
  assert.equal(first[1].id, reordered[0].id);
});

test('canonical project environment round-trips without parallel arrays', () => {
  const projects = [{ dir: path.resolve('logs'), cwd: path.resolve('source'), name: 'Fama' }];
  const serialized = selectedProjectsEnvironment(projects);
  const parsed = selectedProjectsFromEnvironment({ FAMA_SELECTED_PROJECTS: serialized }, {});
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Fama');
  assert.equal(parsed[0].cwd, path.resolve('source'));
});

test('legacy config selection migrates through the canonical Interface', () => {
  const resolver = (encoded) => (encoded === '-valid' ? path.resolve('transcripts') : null);
  assert.deepEqual(encodedSelectionFromConfig({ watchDirEncoded: '-valid' }, resolver), ['-valid']);
  const projects = selectedProjectsFromEncoded(['-valid', 'bad'], {
    projectDirFromEncoded: resolver,
    realCwdFor: () => path.resolve('source'),
    encodeProjectDir: () => '-valid',
  });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].encoded, '-valid');
});

test('renderer selections preserve a browsed cwd only when its encoding matches', () => {
  const cwd = path.resolve('browsed-project');
  const encoded = '-browsed-project';
  const dependencies = {
    projectDirFromEncoded: (value) => (value === encoded ? path.resolve('logs') : null),
    realCwdFor: () => null,
    encodeProjectDir: (value) => (value === cwd ? encoded : '-different'),
  };
  const trusted = selectedProjectsFromSelection([{ encoded, path: cwd }], dependencies);
  const rejected = selectedProjectsFromSelection([{ encoded, path: path.resolve('spoofed') }], dependencies);
  assert.equal(trusted[0].cwd, cwd);
  assert.equal(rejected[0].cwd, null);
});
