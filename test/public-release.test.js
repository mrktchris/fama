'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('public landing page names the current supported release and avoids unavailable downloads', () => {
  const landing = read('docs/index.html');
  assert.match(landing, /releases\/download\/v1\.1\.0\/Fama-Setup\.exe/);
  assert.match(landing, /Latest release: Fama 1\.1\.0 for Windows x64/);
  assert.doesNotMatch(landing, /download\/Fama-macOS-universal\.dmg/);
  assert.doesNotMatch(landing, /\uFFFD/);
});

test('landing page is deployed by an explicit Pages workflow', () => {
  const workflow = read('.github/workflows/pages.yml');
  assert.match(workflow, /actions\/upload-pages-artifact@/);
  assert.match(workflow, /actions\/deploy-pages@/);
  assert.match(workflow, /path: docs/);
});

test('release workflow validates macOS before publishing a cross-platform release', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /macos-release-preflight:/);
  assert.match(workflow, /windows-release:\s+    runs-on: windows-latest\s+    needs: macos-release-preflight/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(workflow, /MAC_CSC_LINK: \$\{\{ secrets\.MAC_CSC_LINK \}\}/);
  assert.match(workflow, /if \[\[ -n "\$MAC_CSC_LINK" \]\]; then/);
});

test('public release checklist covers platform parity and download verification', () => {
  const checklist = read('docs/LAUNCH-CHECKLIST.md');
  assert.match(checklist, /every\s+platform advertised in README has a matching downloadable asset/);
  assert.match(checklist, /SHA256SUMS\.txt/);
  assert.match(checklist, /10&ndash;20 beta users/);
});
