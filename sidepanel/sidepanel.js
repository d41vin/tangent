import { debounce } from '../lib/debounce.js';
import {
  createGlobalNote,
  ensureInitialGlobalNote,
  getGlobalNotes,
  openGlobalNote,
  renameGlobalNote,
  saveGlobalNoteContent,
} from '../lib/storage.js';

const app = document.querySelector('#app');
const state = { mode: 'global', view: 'editor', currentNote: null, menuOpen: false };

const autosaveContent = debounce(async (id, content) => {
  const saved = await saveGlobalNoteContent(id, content);
  if (saved && state.currentNote?.id === id) state.currentNote = saved;
}, 500);

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 45) return 'Edited just now';
  if (seconds < 90) return 'Edited 1 min ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Edited ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Edited yesterday';
  if (days < 7) return `Edited ${days} days ago`;
  return `Edited ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)}`;
}

function menuMarkup() {
  if (!state.menuOpen) return '';
  return `<div class="menu" role="menu" aria-label="Note actions">
    <div class="menu-hint">Actions arrive in Session 5.</div>
    <button class="menu-item" type="button" disabled>Copy All</button>
    <button class="menu-item" type="button" disabled>Download as Markdown</button>
    <button class="menu-item" type="button" disabled>Clear Note Text</button>
    <button class="menu-item" type="button" disabled>Delete Note</button>
    <div class="menu-separator"></div>
    <button class="menu-item" type="button" disabled>Settings</button>
  </div>`;
}

function shellMarkup(content) {
  return `<div class="app-shell">
    <header class="topbar">
      <div class="tabs" role="tablist" aria-label="Tangent mode">
        <button class="tab" id="global-tab" role="tab" aria-selected="${state.mode === 'global'}">Global</button>
        <button class="tab" id="sessions-tab" role="tab" aria-selected="${state.mode === 'sessions'}">Sessions</button>
      </div>
      <button class="icon-button" id="list-button" type="button" aria-label="Open list view" title="Open list view">☰</button>
      <button class="icon-button" id="menu-button" type="button" aria-label="Open note actions" aria-expanded="${state.menuOpen}" title="Note actions">⋮</button>
    </header>${content}</div>${menuMarkup()}`;
}

function editorMarkup() {
  const note = state.currentNote;
  return shellMarkup(`<section class="view" aria-label="Global note editor">
    <div class="editor-header"><button class="note-title" id="note-title" type="button" title="Rename note">${escapeHtml(note.title)}</button></div>
    <textarea class="note-canvas" id="note-content" aria-label="${escapeHtml(note.title)}" placeholder="Jot something down…" spellcheck="true">${escapeHtml(note.content)}</textarea>
  </section>`);
}

function listMarkup(notes) {
  const rows = notes.map((note) => `<button class="note-row" type="button" data-note-id="${escapeHtml(note.id)}">
      <span class="note-row-title">${escapeHtml(note.title)}</span>
      <span class="note-row-meta">${relativeTime(note.updatedAt)}</span>
    </button>`).join('');
  return shellMarkup(`<section class="view" aria-label="Global notes list">
    <header class="view-header"><button class="icon-button" id="back-button" type="button" aria-label="Back to editor">←</button><span class="view-title">Global Notes</span></header>
    <div class="list-actions"><button class="text-button" id="new-note-button" type="button">+ New Note</button></div>
    <div class="note-list">${rows}</div>
  </section>`);
}

function sessionsMarkup() {
  return shellMarkup(`<section class="view" aria-label="Sessions"><div class="empty-state">
    <h1>Sessions are next</h1><p>Session notes and live page context are scheduled for the next build session.</p>
  </div></section>`);
}

function bindShell() {
  document.querySelector('#global-tab').addEventListener('click', async () => {
    if (state.mode === 'global') return;
    state.mode = 'global'; state.view = 'editor'; state.menuOpen = false;
    state.currentNote = await ensureInitialGlobalNote();
    render();
  });
  document.querySelector('#sessions-tab').addEventListener('click', () => {
    state.mode = 'sessions'; state.menuOpen = false; render();
  });
  document.querySelector('#list-button').addEventListener('click', async () => {
    if (state.mode !== 'global') return;
    await autosaveContent.flush();
    state.view = 'list'; state.menuOpen = false; render();
  });
  document.querySelector('#menu-button').addEventListener('click', () => {
    state.menuOpen = !state.menuOpen; render();
  });
}

function bindEditor() {
  const title = document.querySelector('#note-title');
  const textarea = document.querySelector('#note-content');
  title.addEventListener('click', () => {
    const input = document.createElement('input');
    input.className = 'note-title-input'; input.value = state.currentNote.title; input.setAttribute('aria-label', 'Note title');
    title.replaceWith(input); input.focus(); input.select();
    let committed = false;
    const commit = async () => {
      if (committed) return;
      committed = true;
      const saved = await renameGlobalNote(state.currentNote.id, input.value);
      if (saved) state.currentNote = saved;
      render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
      if (event.key === 'Escape') { committed = true; render(); }
    });
  });
  textarea.addEventListener('input', () => {
    const { id } = state.currentNote;
    state.currentNote = { ...state.currentNote, content: textarea.value };
    autosaveContent(id, textarea.value);
  });
}

function bindList() {
  document.querySelector('#back-button').addEventListener('click', async () => {
    state.view = 'editor'; state.currentNote = await ensureInitialGlobalNote(); render();
  });
  document.querySelector('#new-note-button').addEventListener('click', async () => {
    state.currentNote = await createGlobalNote(); state.view = 'editor'; render();
  });
  document.querySelectorAll('[data-note-id]').forEach((button) => button.addEventListener('click', async () => {
    state.currentNote = await openGlobalNote(button.dataset.noteId); state.view = 'editor'; render();
  }));
}

async function render() {
  if (state.mode === 'sessions') {
    app.innerHTML = sessionsMarkup(); bindShell(); return;
  }
  if (state.view === 'list') {
    app.innerHTML = listMarkup(await getGlobalNotes()); bindShell(); bindList(); return;
  }
  app.innerHTML = editorMarkup(); bindShell(); bindEditor();
}

async function initialize() {
  state.currentNote = await ensureInitialGlobalNote();
  await render();
}

initialize().catch((error) => {
  console.error('Unable to initialize Tangent:', error);
  app.textContent = 'Tangent could not open. Reload the extension and try again.';
});
