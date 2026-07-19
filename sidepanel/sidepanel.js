import { debounce } from '../lib/debounce.js';
import {
  createGlobalNote,
  createSession,
  deleteGlobalNote,
  deleteSession,
  ensureInitialGlobalNote,
  getActiveSession,
  getGlobalNotes,
  getSessions,
  openGlobalNote,
  openSession,
  renameGlobalNote,
  renameSession,
  saveGlobalNoteContent,
  saveSessionContent,
  getTrackingSettings,
  setDeepDiveTracking,
  setTheme,
  setTrackingPaused,
  toggleSessionPinned,
} from '../lib/storage.js';
import { getFaviconUrl } from '../lib/favicon.js';
import { formatNoteForExport, markdownFilename } from '../lib/formatter.js';

const app = document.querySelector('#app');
const panelPort = chrome.runtime.connect({ name: 'tangent-panel' });
const inIncognitoContext = Boolean(chrome.extension?.inIncognitoContext);
const state = {
  mode: 'global',
  view: 'editor',
  currentNote: null,
  currentSession: null,
  menuOpen: false,
  sessionContextExpanded: false,
  recordingActive: false,
  deepDiveTracking: false,
  trackingPaused: false,
  theme: 'system',
  inIncognitoContext,
  deleteArmed: false,
};
let deleteArmTimeoutId = null;

function publishPanelState() {
  panelPort.postMessage({
    type: 'panel-state',
    mode: state.mode,
    sessionId: state.mode === 'sessions' ? state.currentSession?.id ?? null : null,
    inIncognito: state.inIncognitoContext,
  });
}

panelPort.onMessage.addListener((message) => {
  if (message?.type !== 'tracking-state' || state.recordingActive === message.recording) return;
  state.recordingActive = message.recording;
  if (state.mode === 'sessions' && state.currentSession) render();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.sessions && state.currentSession) {
    const updatedSession = changes.sessions.newValue?.[state.currentSession.id];
    if (updatedSession && updatedSession.links.length !== state.currentSession.links.length) {
      state.currentSession = updatedSession;
      render();
    }
  }

  if (changes.settings || changes.trackingPaused) {
    refreshTrackingSettings().then(() => {
      if (state.view === 'settings') render();
    });
  }
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'system' ? '' : theme;
}

async function refreshTrackingSettings() {
  const { settings, trackingPaused } = await getTrackingSettings();
  state.deepDiveTracking = settings.deepDiveTracking;
  state.trackingPaused = trackingPaused;
  state.theme = settings.theme;
  applyTheme(state.theme);
}

const autosaveGlobalContent = debounce(async (id, content) => {
  const saved = await saveGlobalNoteContent(id, content);
  if (saved && state.currentNote?.id === id) state.currentNote = saved;
}, 500);

const autosaveSessionContent = debounce(async (id, content) => {
  const saved = await saveSessionContent(id, content);
  if (saved && state.currentSession?.id === id) state.currentSession = saved;
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

function dateTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function menuMarkup() {
  if (!state.menuOpen) return '';
  const activeItem = state.mode === 'sessions' ? state.currentSession : state.currentNote;
  const itemName = state.mode === 'sessions' ? 'Session' : 'Note';
  const editorActions = state.view === 'editor' && activeItem
    ? `<button class="menu-item" id="copy-button" type="button">Copy All</button>
       <button class="menu-item" id="download-button" type="button">Download as Markdown</button>
       <button class="menu-item" id="clear-button" type="button">Clear Note Text</button>
       <button class="menu-item menu-item-danger" id="delete-button" type="button">${state.deleteArmed ? `Confirm delete ${itemName}` : `Delete ${itemName}`}</button>
       <div class="menu-separator"></div>`
    : '';
  return `<div class="menu" role="menu" aria-label="${itemName} actions">
    ${editorActions}
    <button class="menu-item" id="settings-button" type="button">Settings</button>
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

function globalEditorMarkup() {
  const note = state.currentNote;
  return shellMarkup(`<section class="view" aria-label="Global note editor">
    <div class="editor-header"><button class="note-title" id="note-title" type="button" title="Rename note">${escapeHtml(note.title)}</button></div>
    <textarea class="note-canvas" id="note-content" aria-label="${escapeHtml(note.title)}" placeholder="Jot something down…" spellcheck="true">${escapeHtml(note.content)}</textarea>
  </section>`);
}

function globalEmptyMarkup() {
  return shellMarkup(`<section class="view" aria-label="Global notes empty state"><div class="empty-state">
    <h1>No notes yet</h1><p>Create a note whenever you need a clean scratchpad.</p>
    <div><button class="text-button" id="new-note-button" type="button">+ New Note</button></div>
  </div></section>`);
}

function globalListMarkup(notes) {
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

function sessionEditorMarkup() {
  const session = state.currentSession;
  const context = session.links.length === 0
    ? '<p class="context-empty">No pages recorded yet.</p>'
    : session.links.map((link) => `<a class="context-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
        <img class="link-favicon" src="${escapeHtml(getFaviconUrl(link.url))}" width="16" height="16" alt="">
        <span class="context-link-copy"><span class="context-link-title">${escapeHtml(link.title || link.url)}</span><span class="context-link-url">${escapeHtml(link.url)}</span></span>
      </a>`).join('');
  return shellMarkup(`<section class="view" aria-label="Session editor">
    <div class="editor-header session-editor-header">
      <button class="note-title" id="session-title" type="button" title="Rename session">${escapeHtml(session.title)}</button>
      <div class="session-metadata">Created ${dateTime(session.createdAt)} · ${relativeTime(session.updatedAt)}</div>
      ${state.recordingActive ? '<div class="session-status" aria-label="Recording indicator"><span class="recording-dot" aria-hidden="true"></span>Recording</div>' : ''}
    </div>
    <textarea class="note-canvas" id="session-content" aria-label="${escapeHtml(session.title)}" placeholder="Jot something down…" spellcheck="true">${escapeHtml(session.content)}</textarea>
    <section class="session-context" aria-label="Session context">
      <button class="context-toggle" id="context-toggle" type="button" aria-expanded="${state.sessionContextExpanded}">${state.sessionContextExpanded ? '▾' : '▸'} Session context · ${session.links.length} links</button>
      ${state.sessionContextExpanded ? `<div class="context-body">${context}</div>` : ''}
    </section>
  </section>`);
}

function sessionListMarkup(sessions) {
  const rows = sessions.map((session) => `<div class="session-row">
      <button class="session-row-main" type="button" data-session-id="${escapeHtml(session.id)}">
        <span class="note-row-title">${escapeHtml(session.title)}</span>
        <span class="note-row-meta">Created ${dateTime(session.createdAt)} · ${relativeTime(session.updatedAt)}</span>
      </button>
      <button class="pin-button${session.pinned ? ' is-pinned' : ''}" type="button" data-pin-session-id="${escapeHtml(session.id)}" aria-label="${session.pinned ? 'Unpin' : 'Pin'} ${escapeHtml(session.title)}" aria-pressed="${Boolean(session.pinned)}" title="${session.pinned ? 'Unpin session' : 'Pin session'}"><svg class="pin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7Z" fill="${session.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"></path></svg></button>
    </div>`).join('');
  return shellMarkup(`<section class="view" aria-label="Sessions history list">
    <header class="view-header"><button class="icon-button" id="back-button" type="button" aria-label="Back to editor">←</button><span class="view-title">Sessions</span></header>
    <div class="list-actions"><button class="text-button" id="new-session-button" type="button">+ New Session</button></div>
    <div class="note-list">${rows}</div>
  </section>`);
}

function sessionsEmptyMarkup() {
  return shellMarkup(`<section class="view" aria-label="Sessions empty state"><div class="empty-state">
    <h1>No sessions yet</h1><p>Start a session to keep notes alongside the pages you visit.</p>
    <div><button class="text-button" id="new-session-button" type="button">+ New Session</button></div>
  </div></section>`);
}

function settingsMarkup() {
  const deepDiveAvailable = !state.inIncognitoContext;
  const deepDiveActive = deepDiveAvailable && state.deepDiveTracking;
  const status = state.inIncognitoContext
    ? 'Off in Incognito'
    : state.deepDiveTracking ? 'On' : 'Off';
  const pauseControl = deepDiveActive
    ? `<button class="text-button settings-control" id="tracking-pause-button" type="button">${state.trackingPaused ? 'Resume tracking' : 'Pause tracking'}</button>`
    : '';

  return shellMarkup(`<section class="view" aria-label="Settings">
    <header class="view-header"><button class="icon-button" id="settings-back-button" type="button" aria-label="Back to editor">←</button><span class="view-title">Settings</span></header>
    <div class="settings-list">
      <section class="settings-item">
        <div class="settings-item-header"><label class="settings-label" for="theme-select">Theme</label><select class="settings-select" id="theme-select" aria-label="Theme"><option value="system" ${state.theme === 'system' ? 'selected' : ''}>System</option><option value="light" ${state.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>Dark</option></select></div>
      </section>
      <section class="settings-item">
        <div class="settings-item-header"><span class="settings-label">Deep Dive tracking</span><button class="settings-toggle" id="deep-dive-toggle" type="button" aria-pressed="${deepDiveActive}" ${deepDiveAvailable ? '' : 'disabled'}>${status}</button></div>
        <p>Keep recording session links even when the panel is closed. Automatically turned off while browsing in Incognito.</p>
        ${pauseControl}
      </section>
    </div>
  </section>`);
}

async function showGlobalEditor() {
  await autosaveSessionContent.flush();
  state.mode = 'global';
  state.view = 'editor';
  state.menuOpen = false;
  disarmDelete();
  state.currentNote = await ensureInitialGlobalNote();
  await render();
}

async function showSessionEditor() {
  await autosaveGlobalContent.flush();
  state.mode = 'sessions';
  state.view = 'editor';
  state.menuOpen = false;
  disarmDelete();
  state.currentSession = await getActiveSession();
  state.sessionContextExpanded = false;
  await render();
}

function bindShell() {
  document.querySelector('#global-tab').addEventListener('click', () => {
    if (state.mode !== 'global') showGlobalEditor();
  });
  document.querySelector('#sessions-tab').addEventListener('click', () => {
    if (state.mode !== 'sessions') showSessionEditor();
  });
  document.querySelector('#list-button').addEventListener('click', async () => {
    if (state.mode === 'global') {
      await autosaveGlobalContent.flush();
    } else {
      await autosaveSessionContent.flush();
    }
    state.view = 'list';
    state.menuOpen = false;
    disarmDelete();
    await render();
  });
  document.querySelector('#menu-button').addEventListener('click', () => {
    state.menuOpen = !state.menuOpen;
    if (!state.menuOpen) disarmDelete();
    render();
  });
  const settingsButton = document.querySelector('#settings-button');
  if (settingsButton) settingsButton.addEventListener('click', showSettings);
  const copyButton = document.querySelector('#copy-button');
  if (copyButton) copyButton.addEventListener('click', copyCurrentItem);
  const downloadButton = document.querySelector('#download-button');
  if (downloadButton) downloadButton.addEventListener('click', downloadCurrentItem);
  const clearButton = document.querySelector('#clear-button');
  if (clearButton) clearButton.addEventListener('click', clearCurrentItem);
  const deleteButton = document.querySelector('#delete-button');
  if (deleteButton) deleteButton.addEventListener('click', handleDelete);
}

function currentItem() {
  return state.mode === 'sessions' ? state.currentSession : state.currentNote;
}

async function flushCurrentAutosave() {
  if (state.mode === 'sessions') await autosaveSessionContent.flush();
  else await autosaveGlobalContent.flush();
}

function currentItemExport() {
  return formatNoteForExport(currentItem(), state.mode === 'sessions');
}

async function copyCurrentItem() {
  await flushCurrentAutosave();
  await navigator.clipboard.writeText(currentItemExport());
  state.menuOpen = false;
  disarmDelete();
  await render();
}

async function downloadCurrentItem() {
  await flushCurrentAutosave();
  const item = currentItem();
  const blob = new Blob([currentItemExport()], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = markdownFilename(item.title);
  link.click();
  URL.revokeObjectURL(url);
  state.menuOpen = false;
  disarmDelete();
  await render();
}

async function clearCurrentItem() {
  await flushCurrentAutosave();
  const item = currentItem();
  const saved = state.mode === 'sessions'
    ? await saveSessionContent(item.id, '')
    : await saveGlobalNoteContent(item.id, '');
  if (state.mode === 'sessions') state.currentSession = saved;
  else state.currentNote = saved;
  state.menuOpen = false;
  disarmDelete();
  await render();
}

function disarmDelete() {
  state.deleteArmed = false;
  if (deleteArmTimeoutId) clearTimeout(deleteArmTimeoutId);
  deleteArmTimeoutId = null;
}

async function deleteCurrentItem() {
  await flushCurrentAutosave();
  if (state.mode === 'sessions') {
    state.currentSession = await deleteSession(state.currentSession.id);
  } else {
    state.currentNote = await deleteGlobalNote(state.currentNote.id);
    if (!state.currentNote) state.view = 'list';
  }
  state.menuOpen = false;
  disarmDelete();
  await render();
}

async function handleDelete() {
  if (state.deleteArmed) {
    await deleteCurrentItem();
    return;
  }

  state.deleteArmed = true;
  deleteArmTimeoutId = setTimeout(() => {
    state.deleteArmed = false;
    deleteArmTimeoutId = null;
    if (state.menuOpen) render();
  }, 3000);
  await render();
}

function beginTitleEdit({ title, item, label, save }) {
  const input = document.createElement('input');
  input.className = 'note-title-input';
  input.value = item.title;
  input.setAttribute('aria-label', `${label} title`);
  title.replaceWith(input);
  input.focus();
  input.select();
  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const saved = await save(item.id, input.value);
    if (saved) {
      if (label === 'Note') state.currentNote = saved;
      else state.currentSession = saved;
    }
    render();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
    if (event.key === 'Escape') {
      committed = true;
      render();
    }
  });
}

function bindGlobalEditor() {
  document.querySelector('#note-title').addEventListener('click', (event) => beginTitleEdit({
    title: event.currentTarget,
    item: state.currentNote,
    label: 'Note',
    save: renameGlobalNote,
  }));
  document.querySelector('#note-content').addEventListener('input', (event) => {
    const { id } = state.currentNote;
    state.currentNote = { ...state.currentNote, content: event.currentTarget.value };
    autosaveGlobalContent(id, event.currentTarget.value);
  });
}

function bindGlobalList() {
  document.querySelector('#back-button').addEventListener('click', showGlobalEditor);
  document.querySelector('#new-note-button').addEventListener('click', async () => {
    state.currentNote = await createGlobalNote();
    state.view = 'editor';
    await render();
  });
  document.querySelectorAll('[data-note-id]').forEach((button) => button.addEventListener('click', async () => {
    state.currentNote = await openGlobalNote(button.dataset.noteId);
    state.view = 'editor';
    await render();
  }));
}

function bindSessionEditor() {
  document.querySelector('#session-title').addEventListener('click', (event) => beginTitleEdit({
    title: event.currentTarget,
    item: state.currentSession,
    label: 'Session',
    save: renameSession,
  }));
  document.querySelector('#session-content').addEventListener('input', (event) => {
    const { id } = state.currentSession;
    state.currentSession = { ...state.currentSession, content: event.currentTarget.value };
    autosaveSessionContent(id, event.currentTarget.value);
  });
  document.querySelector('#context-toggle').addEventListener('click', () => {
    state.sessionContextExpanded = !state.sessionContextExpanded;
    render();
  });
  document.querySelectorAll('.link-favicon').forEach((favicon) => {
    favicon.addEventListener('error', () => { favicon.hidden = true; });
  });
}

async function createAndOpenSession() {
  state.currentSession = await createSession();
  state.view = 'editor';
  state.sessionContextExpanded = false;
  await render();
  panelPort.postMessage({ type: 'capture-active-tab' });
}

function bindSessionList() {
  document.querySelector('#back-button').addEventListener('click', showSessionEditor);
  document.querySelector('#new-session-button').addEventListener('click', createAndOpenSession);
  document.querySelectorAll('[data-session-id]').forEach((button) => button.addEventListener('click', async () => {
    state.currentSession = await openSession(button.dataset.sessionId);
    state.view = 'editor';
    state.sessionContextExpanded = false;
    await render();
  }));
  document.querySelectorAll('[data-pin-session-id]').forEach((button) => button.addEventListener('click', async () => {
    await toggleSessionPinned(button.dataset.pinSessionId);
    await render();
  }));
}

function bindSessionsEmpty() {
  document.querySelector('#new-session-button').addEventListener('click', createAndOpenSession);
}

function bindGlobalEmpty() {
  document.querySelector('#new-note-button').addEventListener('click', async () => {
    state.currentNote = await createGlobalNote();
    state.view = 'editor';
    await render();
  });
}

async function showSettings() {
  if (state.mode === 'global') await autosaveGlobalContent.flush();
  else await autosaveSessionContent.flush();
  state.view = 'settings';
  state.menuOpen = false;
  await refreshTrackingSettings();
  await render();
}

function bindSettings() {
  document.querySelector('#settings-back-button').addEventListener('click', async () => {
    state.view = 'editor';
    await render();
  });
  document.querySelector('#theme-select').addEventListener('change', async (event) => {
    await setTheme(event.currentTarget.value);
    await refreshTrackingSettings();
    await render();
  });
  const deepDiveToggle = document.querySelector('#deep-dive-toggle');
  if (!deepDiveToggle.disabled) {
    deepDiveToggle.addEventListener('click', async () => {
      await setDeepDiveTracking(!state.deepDiveTracking);
      await refreshTrackingSettings();
      await render();
    });
  }
  const pauseButton = document.querySelector('#tracking-pause-button');
  if (pauseButton) {
    pauseButton.addEventListener('click', async () => {
      await setTrackingPaused(!state.trackingPaused);
      await refreshTrackingSettings();
      await render();
    });
  }
}

async function render() {
  if (state.view === 'settings') {
    app.innerHTML = settingsMarkup();
    bindShell();
    bindSettings();
  } else if (state.mode === 'global') {
    if (state.view === 'list') {
      app.innerHTML = globalListMarkup(await getGlobalNotes());
      bindShell();
      bindGlobalList();
    } else if (state.currentNote) {
      app.innerHTML = globalEditorMarkup();
      bindShell();
      bindGlobalEditor();
    } else {
      app.innerHTML = globalEmptyMarkup();
      bindShell();
      bindGlobalEmpty();
    }
  } else if (state.view === 'list') {
    app.innerHTML = sessionListMarkup(await getSessions());
    bindShell();
    bindSessionList();
  } else if (!state.currentSession) {
    app.innerHTML = sessionsEmptyMarkup();
    bindShell();
    bindSessionsEmpty();
  } else {
    app.innerHTML = sessionEditorMarkup();
    bindShell();
    bindSessionEditor();
  }
  publishPanelState();
}

async function initialize() {
  state.currentNote = await ensureInitialGlobalNote();
  await refreshTrackingSettings();
  await render();
}

initialize().catch((error) => {
  console.error('Unable to initialize Tangent:', error);
  app.textContent = 'Tangent could not open. Reload the extension and try again.';
});
