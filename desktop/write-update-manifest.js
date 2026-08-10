#!/usr/bin/env node
'use strict';

// Real bug, found by reviewing this project's own test logs, not by
// inspection: every packaged build since 0.7.0 has logged
// "ENOENT: ... resources\app-update.yml" on every single launch and
// "check for updates" click. electron-updater needs that file to know where
// to check; electron-builder's NSIS target writes it automatically as part
// of packaging, but that target can't run in this build environment (see
// README, the Developer Mode / symlink permission wall), so electron-packager
// is used instead and it has no idea electron-updater exists, it never
// writes this file. One-click auto-update has been silently non-functional
// in every shipped build up to and including 0.11.0, always failing closed
// (caught, logged, no crash, no dialog on the silent startup check), which
// is exactly why nobody, including in-app testing, surfaced it as broken.
//
// Fix: write the same minimal manifest electron-builder would have, by hand,
// straight from package.json's own publish config, so there's exactly one
// source of truth for owner/repo instead of a second hardcoded copy.

const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const publish = (pkg.build && pkg.build.publish) || {};
if (!publish.owner || !publish.repo) {
  console.error('[write-update-manifest] package.json build.publish is missing owner/repo, cannot write a manifest.');
  process.exit(1);
}

const manifest = [
  `provider: ${publish.provider || 'github'}`,
  `owner: ${publish.owner}`,
  `repo: ${publish.repo}`,
  `updaterCacheDirName: ${pkg.name}-updater`,
  '',
].join('\n');

const OUT_DIR = path.join(__dirname, '..', 'dist-desktop');
if (!fs.existsSync(OUT_DIR)) {
  console.error(`[write-update-manifest] ${OUT_DIR} doesn't exist, run packaging first.`);
  process.exit(1);
}

let written = 0;
for (const entry of fs.readdirSync(OUT_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const resourcesDir = path.join(OUT_DIR, entry.name, 'resources');
  if (!fs.existsSync(resourcesDir)) continue;
  fs.writeFileSync(path.join(resourcesDir, 'app-update.yml'), manifest, 'utf8');
  written += 1;
}

console.log(`[write-update-manifest] wrote app-update.yml into ${written} package(s).`);
