'use strict';

const listEl = document.getElementById('list');
const browseBtn = document.getElementById('browse');
const continueBtn = document.getElementById('continue');

// encoded -> { encoded, path, lastActive } for everything currently shown,
// checked state lives on the checkbox itself, this map is just for lookups
// when a picked folder is already in the discovered list.
const known = new Map();
const checkedEncoded = new Set();

function timeAgo(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function updateContinueState() {
  continueBtn.disabled = checkedEncoded.size === 0;
  continueBtn.textContent = checkedEncoded.size > 1 ? `Continue with ${checkedEncoded.size} projects` : 'Continue';
}

function addRow(p) {
  known.set(p.encoded, p);
  const row = document.createElement('label');
  row.className = 'project-option';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checkedEncoded.has(p.encoded);
  row.classList.toggle('checked', box.checked);
  box.addEventListener('change', () => {
    if (box.checked) checkedEncoded.add(p.encoded);
    else checkedEncoded.delete(p.encoded);
    row.classList.toggle('checked', box.checked);
    updateContinueState();
  });
  const text = document.createElement('div');
  text.className = 'text';
  const pathEl = document.createElement('div');
  pathEl.className = 'path';
  pathEl.textContent = p.path;
  const metaEl = document.createElement('div');
  metaEl.className = 'meta';
  metaEl.textContent = `last active ${timeAgo(p.lastActive)}`;
  text.appendChild(pathEl);
  text.appendChild(metaEl);
  row.appendChild(box);
  row.appendChild(text);
  listEl.appendChild(row);
}

function renderProjects(projects) {
  listEl.innerHTML = '';
  if (!projects.length) {
    listEl.innerHTML = '<div id="empty">No Claude Code or Codex sessions found yet. Start one, or browse for a folder below.</div>';
    return;
  }
  for (const p of projects) addRow(p);
}

Promise.all([window.famaSetup.listProjects(), window.famaSetup.getCurrentProjects()]).then(([projects, current]) => {
  // Reopened later ("Manage watched projects…" from the tray) instead of
  // first-run: pre-check whatever's already being watched so this reads as
  // "edit your selection", not "start over".
  for (const encoded of current || []) checkedEncoded.add(encoded);
  renderProjects(projects);
  // A currently-watched project might not be in the freshly-discovered list
  // (e.g. its most recent session aged past what listAvailableProjects shows),
  // still surface it checked rather than silently dropping it from the set.
  for (const encoded of checkedEncoded) {
    if (!known.has(encoded)) addRow({ encoded, path: encoded, lastActive: 0 });
  }
  updateContinueState();
});

browseBtn.addEventListener('click', async () => {
  const picked = await window.famaSetup.pickFolder();
  if (!picked) return;
  checkedEncoded.add(picked.encoded);
  if (!known.has(picked.encoded)) {
    addRow(picked);
  } else {
    for (const row of listEl.querySelectorAll('.project-option')) {
      const box = row.querySelector('input[type="checkbox"]');
      if (row.querySelector('.path').textContent === picked.path) {
        box.checked = true;
        row.classList.add('checked');
      }
    }
  }
  updateContinueState();
});

continueBtn.addEventListener('click', () => {
  if (!checkedEncoded.size) return;
  continueBtn.disabled = true;
  continueBtn.textContent = 'Starting…';
  window.famaSetup.confirmProjects(
    [...checkedEncoded].map((encoded) => {
      const project = known.get(encoded);
      return project ? { encoded, path: project.path } : { encoded };
    })
  );
});
