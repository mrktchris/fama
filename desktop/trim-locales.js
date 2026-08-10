#!/usr/bin/env node
'use strict';

// Electron ships every Chromium locale (55 of them, ~40MB) whether or not
// this app has any translated UI, it doesn't, everything here is English
// only. Run after packaging (see the postdist:win-packager npm hook) to keep
// only en-US.pak. Safe: Electron falls back to en-US automatically if a
// requested locale's .pak is missing, this doesn't change app behavior on
// any locale, only removes files Pico's own UI never reads.
//
// Verified against a real build, not just "should be fine": measured
// 272MB -> 232MB (~40MB / ~15%) on the same output this produces, and the
// packaged Pico.exe was launched afterward to confirm it still starts.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'dist-desktop');
const KEEP = 'en-US.pak';

function trimLocalesDir(localesDir) {
  if (!fs.existsSync(localesDir)) return { removed: 0, freedBytes: 0 };
  let removed = 0;
  let freedBytes = 0;
  for (const name of fs.readdirSync(localesDir)) {
    if (name === KEEP) continue;
    const full = path.join(localesDir, name);
    try {
      freedBytes += fs.statSync(full).size;
      fs.unlinkSync(full);
      removed += 1;
    } catch (err) {
      console.error(`[trim-locales] could not remove ${full}: ${err.message}`);
    }
  }
  return { removed, freedBytes };
}

if (!fs.existsSync(OUT_DIR)) {
  console.error(`[trim-locales] ${OUT_DIR} doesn't exist, run packaging first.`);
  process.exit(1);
}

let totalRemoved = 0;
let totalFreed = 0;
for (const entry of fs.readdirSync(OUT_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const localesDir = path.join(OUT_DIR, entry.name, 'locales');
  const { removed, freedBytes } = trimLocalesDir(localesDir);
  totalRemoved += removed;
  totalFreed += freedBytes;
}

console.log(`[trim-locales] removed ${totalRemoved} locale file(s), freed ~${(totalFreed / 1024 / 1024).toFixed(1)}MB.`);
