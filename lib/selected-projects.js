'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stableProjectId(cwd, dir) {
  const resolved = path.resolve(cwd || dir);
  const identity = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

function selectedProject(input) {
  const dir = nonEmptyString(input && (input.dir || input.transcriptDir));
  if (!dir) throw new TypeError('Selected Project requires a transcript directory.');
  const cwd = nonEmptyString(input.cwd);
  const name = nonEmptyString(input.name) || path.basename(cwd || dir);
  const id = nonEmptyString(input.id) || stableProjectId(cwd, dir);
  const project = { id, dir: path.resolve(dir), cwd: cwd ? path.resolve(cwd) : null, name };
  const encoded = nonEmptyString(input.encoded);
  if (encoded) project.encoded = encoded;
  return Object.freeze(project);
}

function dedupeProjects(projects) {
  const byId = new Map();
  for (const project of projects) {
    const canonical = selectedProject(project);
    if (!byId.has(canonical.id)) byId.set(canonical.id, canonical);
  }
  return [...byId.values()];
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function selectedProjectsFromEnvironment(env, fallback) {
  const canonical = env.FAMA_SELECTED_PROJECTS ? parseJsonArray(env.FAMA_SELECTED_PROJECTS) : [];
  if (canonical.length) {
    try {
      return dedupeProjects(canonical);
    } catch {
      // A malformed canonical value must not broaden the watch scope. Fall
      // through to the older, independently validated shapes.
    }
  }

  const dirs = env.CLAUDE_NARRATOR_DIRS ? parseJsonArray(env.CLAUDE_NARRATOR_DIRS) : [];
  if (dirs.length) {
    const cwds = env.FAMA_PROJECT_CWDS ? parseJsonArray(env.FAMA_PROJECT_CWDS) : [];
    const labels = env.FAMA_PROJECT_LABELS ? parseJsonArray(env.FAMA_PROJECT_LABELS) : [];
    return dedupeProjects(dirs.map((dir, index) => ({ dir, cwd: cwds[index] || null, name: labels[index] })));
  }

  return [selectedProject(fallback)];
}

function selectedProjectsEnvironment(projects) {
  return JSON.stringify(
    dedupeProjects(projects).map(({ id, dir, cwd, name }) => ({ id, dir, cwd, name }))
  );
}

function validEncodedProjects(value, projectDirFromEncoded) {
  const candidates = Array.isArray(value) ? value : [value];
  const valid = candidates.filter((encoded) => typeof encoded === 'string' && projectDirFromEncoded(encoded));
  return [...new Set(valid)];
}

function selectedProjectsFromEncoded(value, dependencies) {
  return selectedProjectsFromSelection(
    (Array.isArray(value) ? value : [value]).map((encoded) => ({ encoded })),
    dependencies
  );
}

function selectedProjectsFromSelection(value, dependencies) {
  const selections = Array.isArray(value) ? value : [];
  const projects = [];
  const seenEncoded = new Set();
  for (const selection of selections) {
    const encoded = typeof selection === 'string' ? selection : selection && selection.encoded;
    if (seenEncoded.has(encoded) || !dependencies.projectDirFromEncoded(encoded)) continue;
    seenEncoded.add(encoded);
    const dir = dependencies.projectDirFromEncoded(encoded);
    const proposedCwd = selection && nonEmptyString(selection.path || selection.cwd);
    const trustedProposedCwd =
      proposedCwd &&
      path.isAbsolute(proposedCwd) &&
      typeof dependencies.encodeProjectDir === 'function' &&
      dependencies.encodeProjectDir(proposedCwd) === encoded
        ? proposedCwd
        : null;
    const cwd = trustedProposedCwd || dependencies.realCwdFor(dir) || null;
    projects.push(selectedProject({ encoded, dir, cwd, name: path.basename(cwd || encoded) }));
  }
  return projects;
}

function encodedSelectionFromConfig(config, projectDirFromEncoded) {
  const cfg = config || {};
  if (Array.isArray(cfg.selectedProjects)) {
    const encoded = cfg.selectedProjects.map((project) => project && project.encoded).filter(Boolean);
    if (encoded.length) return validEncodedProjects(encoded, projectDirFromEncoded);
  }
  if (Array.isArray(cfg.watchDirsEncoded)) return validEncodedProjects(cfg.watchDirsEncoded, projectDirFromEncoded);
  if (cfg.watchDirEncoded) return validEncodedProjects(cfg.watchDirEncoded, projectDirFromEncoded);
  return [];
}

module.exports = {
  dedupeProjects,
  encodedSelectionFromConfig,
  selectedProject,
  selectedProjectsEnvironment,
  selectedProjectsFromEncoded,
  selectedProjectsFromEnvironment,
  selectedProjectsFromSelection,
  stableProjectId,
  validEncodedProjects,
};
