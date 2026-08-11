#!/usr/bin/env node
'use strict';

// HARD SAFETY GATE. Runs automatically after packaging and MUST be run before
// any release upload. Exits non-zero (failing the npm script chain) if the
// built package contains anything that must never be distributed.
//
// Why this exists, precisely: `.env` is gitignored, so every git-based check
// says "clean" forever, and that is exactly the false sense of safety that let
// a live OpenAI key ship inside a public release zip twice. The leak path is
// not git, it is the PACKAGER: electron-packager copies the whole project
// directory and does not read .gitignore, so a real .env sitting in the source
// root (written there by running `npm start` from source and saving Settings)
// gets copied straight into resources/app/ and then into the release zip.
//
// electron-builder had a `files` whitelist in package.json that prevented
// this; the switch to electron-packager (forced by an NSIS/symlink permission
// wall in this build environment) silently dropped that protection. The
// --ignore flags in the packaging script are the fix; this script is the
// independent verification that the fix actually held, because a build-time
// flag that silently stops matching is exactly the kind of thing that needs
// checking rather than trusting.

const fs = require('fs');
const path = require('path');

// An explicit directory lets CI/review builds verify an isolated package
// without overwriting a currently-running local installation.
const OUT_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'dist-desktop');

// Filenames that must never appear anywhere in a built package.
const FORBIDDEN_NAMES = new Set(['.env', '.env.local', '.env.production', 'usage.json', 'run.pid', 'electron.pid']);
// Found live in a shipped release: electron.out.log / electron.err.log /
// run.out.log / run.err.log from earlier dev testing were sitting in the
// project root, matched no FORBIDDEN_NAMES entry (they're not fixed names),
// and shipped in the zip anyway, exposing an absolute path (which carries
// the OS username on Windows) and cloud-voice usage details. Checked by
// extension now, not just exact name, so no future *.log file slips through.
const FORBIDDEN_EXTENSIONS = new Set(['.log']);
// Directories that must never be nested inside a build (a build inside a build).
const FORBIDDEN_DIRS = new Set(['dist-desktop', '.git', 'node_modules/.cache']);
// Content patterns that indicate a real secret regardless of filename.
const SECRET_PATTERNS = [
  { name: 'OpenAI API key', re: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'GitHub fine-grained token', re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
];
// Only scan text-ish files for secrets; scanning 100MB of Electron binaries is
// pointless (and slow). A secret that matters here arrives as text.
const TEXT_EXT = new Set(['.js', '.json', '.md', '.txt', '.env', '.example', '.html', '.css', '.yml', '.yaml', '.ps1', '.sh', '']);
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

const problems = [];

function scanDir(dir, relRoot) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(relRoot, full);
    if (entry.isDirectory()) {
      if (FORBIDDEN_DIRS.has(entry.name)) {
        problems.push(`FORBIDDEN DIRECTORY in package: ${rel}`);
        continue;
      }
      scanDir(full, relRoot);
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();

    if (FORBIDDEN_NAMES.has(entry.name) || FORBIDDEN_EXTENSIONS.has(ext)) {
      problems.push(`FORBIDDEN FILE in package: ${rel}`);
      continue; // already fatal, no need to also scan its contents
    }

    if (!TEXT_EXT.has(ext)) continue;
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size > MAX_SCAN_BYTES) continue;
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(content)) {
        problems.push(`SECRET (${pattern.name}) found inside packaged file: ${rel}`);
      }
    }
  }
}

if (!fs.existsSync(OUT_DIR)) {
  console.error('[verify-package] dist-desktop does not exist, nothing to verify. Run packaging first.');
  process.exit(1);
}

let packagesChecked = 0;
for (const entry of fs.readdirSync(OUT_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgDir = path.join(OUT_DIR, entry.name);
  packagesChecked += 1;
  scanDir(pkgDir, OUT_DIR);
}

if (!packagesChecked) {
  console.error('[verify-package] no packaged output found in dist-desktop. Run packaging first.');
  process.exit(1);
}

if (problems.length) {
  console.error('\n[verify-package] BUILD REJECTED. Do not upload this package.\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    '\nMost likely cause: a real .env in the project root (created by running from source and saving Settings)\n' +
      'got copied into the package. The packaging script\'s --ignore flags should prevent this; if this fired,\n' +
      'that protection is not working and must be fixed before shipping anything.\n'
  );
  process.exit(1);
}

console.log(`[verify-package] OK: ${packagesChecked} package(s) checked, no secrets or forbidden files found.`);
