'use strict';

const path = require('path');
const os = require('os');

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
  return path.join(os.homedir(), '.claude', 'projects');
}

function projectDirFromEncoded(encoded, root = claudeProjectsRoot()) {
  if (typeof encoded !== 'string' || !encoded || encoded === '.' || encoded === '..') return null;
  // Encoded Claude project identifiers are directory names, never paths. IPC
  // callers must not be able to smuggle separators or dot segments through
  // the selection list and make the server watch outside ~/.claude/projects.
  if (pathBasename(encoded) !== encoded || /[\\/]/.test(encoded)) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, encoded);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null;
  return resolved;
}

function pathBasename(value) {
  // Check both platform separator styles so a Windows-shaped payload remains
  // invalid when tests or CLI mode run on Linux.
  return path.win32.basename(path.posix.basename(value));
}

module.exports = { encodeProjectDir, claudeProjectsRoot, projectDirFromEncoded };
