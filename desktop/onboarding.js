'use strict';

const listEl = document.getElementById('list');
const browseBtn = document.getElementById('browse');

function timeAgo(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function renderProjects(projects) {
  listEl.innerHTML = '';
  if (!projects.length) {
    listEl.innerHTML = '<div id="empty">No Claude Code sessions found yet. Start one, or browse for a folder below.</div>';
    return;
  }
  for (const p of projects) {
    const btn = document.createElement('button');
    btn.className = 'project-option';
    btn.innerHTML = `<div class="path"></div><div class="meta">last active ${timeAgo(p.lastActive)}</div>`;
    btn.querySelector('.path').textContent = p.path;
    btn.addEventListener('click', () => window.narratorSetup.confirmProject(p.encoded));
    listEl.appendChild(btn);
  }
}

window.narratorSetup.listProjects().then(renderProjects);

browseBtn.addEventListener('click', async () => {
  const picked = await window.narratorSetup.pickFolder();
  if (picked) window.narratorSetup.confirmProject(picked.encoded);
});
