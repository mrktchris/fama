#!/usr/bin/env node
'use strict';

// Companion to write-update-manifest.js: that one tells the app WHERE to
// check (app-update.yml, baked into the package); this one is what it finds
// WHEN it checks (latest.yml, uploaded as its own release asset alongside
// the zip). electron-builder generates and uploads both automatically as
// part of its publish step; since this project can't use electron-builder's
// NSIS target in this environment (see README), both are hand-generated
// instead, from the same real zip that gets uploaded, so the hash in here is
// never stale relative to what a user actually downloads.
//
// Usage: node desktop/write-latest-yml.js <path-to-zip>
// Writes dist-desktop/latest.yml. Upload it as a release asset alongside the
// zip (gh release create/upload), same release, both files.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const zipPath = process.argv[2];
if (!zipPath || !fs.existsSync(zipPath)) {
  console.error('[write-latest-yml] usage: node desktop/write-latest-yml.js <path-to-zip>');
  process.exit(1);
}

const pkg = require('../package.json');
const buf = fs.readFileSync(zipPath);
const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
const size = buf.length;
const fileName = path.basename(zipPath);
const releaseDate = new Date().toISOString();

const yml = [
  `version: ${pkg.version}`,
  'files:',
  `  - url: ${fileName}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${fileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  '',
].join('\n');

const outPath = path.join(path.dirname(zipPath), 'latest.yml');
fs.writeFileSync(outPath, yml, 'utf8');
console.log(`[write-latest-yml] wrote ${outPath} for ${fileName} (${(size / 1024 / 1024).toFixed(1)}MB, sha512 ${sha512.slice(0, 16)}...)`);
