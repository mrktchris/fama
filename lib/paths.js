'use strict';

/**
 * Claude Code's own project-folder naming scheme, extracted from server.js
 * and desktop/main.js, which each had their own hand-copied version of this
 * before, drift between the two was a real risk with zero tests to catch it.
 * One implementation now, both files require it.
 */

function encodeProjectDir(cwd) {
  // Windows: "C:\Users\User\Documents\Claude" -> "C--Users-User-Documents-Claude"
  // (verified against real files on a real machine). macOS/Linux:
  // "/Users/name/project" -> "-Users-name-project" (every "/" -> "-",
  // including the leading one) — implemented from Claude Code's known
  // encoding scheme, not verified against a real Mac/Linux machine.
  if (/^[A-Za-z]:\\/.test(cwd)) return cwd.replace(/^([A-Za-z]):\\/, '$1--').replace(/\\/g, '-');
  return cwd.replace(/\//g, '-');
}

function claudeProjectsRoot() {
  const home = process.env.USERPROFILE || process.env.HOME;
  const path = require('path');
  return path.join(home, '.claude', 'projects');
}

module.exports = { encodeProjectDir, claudeProjectsRoot };
