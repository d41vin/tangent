import { debounce } from '../lib/debounce.js';
import {
  createGlobalNote,
  createSession,
  deleteGlobalNote,
  deleteSession,
  ensureInitialGlobalNote,
  exportData,
  getActiveSession,
  getGlobalNotes,
  getSessions,
  importData,
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
  toggleGlobalNotePinned,
  toggleSessionPinned,
  validateBackupPayload,
} from '../lib/storage.js';
import { getFaviconUrl } from '../lib/favicon.js';
import { formatNoteForExport, markdownFilename } from '../lib/formatter.js';

const app = document.querySelector('#app');
const PANEL_HEARTBEAT_MS = 20_000;
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
  shortcut: '',
  inIncognitoContext,
  deleteArmed: false,
  listQuery: '',
  searchQuery: '',
  linkRemoveArmed: null,
  settingsNotice: '',
  pendingImport: null,
};
let deleteArmTimeoutId = null;
let linkRemoveArmTimeoutId = null;
let importArmTimeoutId = null;
let pendingFocusSelector = null;

function requestFocus(selector) {
  pendingFocusSelector = selector;
}

async function publishPanelState() {
  const sessionId = state.mode === 'sessions' ? state.currentSession?.id ?? null : null;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'panel-state',
      mode: state.mode,
      sessionId,
      inIncognito: state.inIncognitoContext,
    });
    // Ignore a response for a view that changed while the message was in flight.
    const stillCurrent = state.mode === 'sessions'
      ? state.currentSession?.id === sessionId
      : sessionId === null;
    if (!stillCurrent || state.recordingActive === Boolean(response?.recording)) return;

    state.recordingActive = Boolean(response?.recording);
    if (state.mode === 'sessions' && state.currentSession) render();
  } catch (error) {
    // The next heartbeat will register this visible panel once Chrome can wake
    // the worker again. Do not leave a stale Recording label in the meantime.
    console.warn('Tangent could not publish panel state:', error);
    if (state.recordingActive) {
      state.recordingActive = false;
      if (state.mode === 'sessions' && state.currentSession) render();
    }
  }
}

async function captureActiveTabForSession() {
  await publishPanelState();
  try {
    await chrome.runtime.sendMessage({ type: 'capture-active-tab' });
  } catch (error) {
    console.warn('Tangent could not capture the active tab:', error);
  }
}

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

async function refreshShortcutStatus() {
  const commands = await chrome.commands.getAll();
  const actionCommand = commands.find((command) => command.name === '_execute_action');
  state.shortcut = actionCommand?.shortcut ?? '';
}

// The worker may stop at any time. This heartbeat re-registers a visible panel
// in session storage, while the worker validates it against Chrome's live
// SIDE_PANEL contexts before recording anything.
window.setInterval(() => {
  if (state.mode === 'sessions' && state.currentSession) publishPanelState();
}, PANEL_HEARTBEAT_MS);

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
  const itemName = state.mode === 'sessions' ? 'Session' : 'Note';
  return `<div class="menu" id="actions-menu" role="menu" aria-label="More actions">
    <button class="menu-item" id="copy-button" type="button" role="menuitem">${COPY_ICON}<span>Copy All</span></button>
    <button class="menu-item" id="download-button" type="button" role="menuitem">${DOWNLOAD_ICON}<span>Download as Markdown</span></button>
    <button class="menu-item" id="clear-button" type="button" role="menuitem">${CLEAR_ICON}<span>Clear text</span></button>
    <button class="menu-item menu-item-danger" id="delete-button" type="button" role="menuitem">${DELETE_ICON}<span>${state.deleteArmed ? `Confirm delete ${itemName}` : `Delete ${itemName}`}</span></button>
  </div>`;
}

function itemActionsMarkup() {
  return `<div class="item-actions">
    <button class="icon-button${state.menuOpen ? ' is-active' : ''}" id="menu-button" type="button" aria-haspopup="menu" aria-controls="actions-menu" aria-expanded="${state.menuOpen}" aria-label="More actions" title="More actions">${MORE_ACTIONS_ICON}</button>
    ${menuMarkup()}
  </div>`;
}

const HEADER_ICON_ATTRS = 'class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const MENU_ICON_ATTRS = 'class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const SETTINGS_ICON = `<svg ${HEADER_ICON_ATTRS}><path d="M19.875 6.27A2.225 2.225 0 0 1 21 8.218v7.284c0 .809-.443 1.555-1.158 1.948l-6.75 4.27a2.269 2.269 0 0 1-2.184 0l-6.75-4.27A2.225 2.225 0 0 1 3 15.502V8.217c0-.809.443-1.554 1.158-1.947l6.75-3.98a2.33 2.33 0 0 1 2.25 0l6.75 3.98h-.033"/><circle cx="12" cy="12" r="3"/></svg>`;
const PLUS_ICON = `<svg ${HEADER_ICON_ATTRS}><path d="M12 5v14M5 12h14"/></svg>`;
const SEARCH_ICON = `<svg ${HEADER_ICON_ATTRS}><circle cx="10" cy="10" r="7"/><path d="m21 21-6-6"/></svg>`;
const LIST_ICON = `<svg ${HEADER_ICON_ATTRS}><path d="M4 6h16M4 12h16M4 18h16"/></svg>`;
const X_ICON_PATH = '<path d="m6 6 12 12M18 6 6 18"/>';
const CLOSE_ICON = `<svg ${HEADER_ICON_ATTRS}>${X_ICON_PATH}</svg>`;
const SEARCH_CLEAR_ICON = `<svg class="search-clear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">${X_ICON_PATH}</svg>`;
const BACK_ICON = `<svg ${HEADER_ICON_ATTRS}><path d="M5 12h14M5 12l6 6M5 12l6-6"/></svg>`;
const MORE_ACTIONS_ICON = `<svg ${HEADER_ICON_ATTRS}><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;
const CARET_RIGHT_ICON = '<svg class="context-caret" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 6c0-.852.986-1.297 1.623-.783l.084.076 6 6a1 1 0 0 1 .083 1.32l-.083.094-6 6a1 1 0 0 1-1.707-.707z"/></svg>';
const CARET_DOWN_ICON = '<svg class="context-caret" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 9c.852 0 1.297.986.783 1.623l-.076.084-6 6a1 1 0 0 1-1.32.083l-.094-.083-6-6A1 1 0 0 1 6 9z"/></svg>';
const COPY_ICON = `<svg ${MENU_ICON_ATTRS}><path d="M7 9.667A2.667 2.667 0 0 1 9.667 7h8.666A2.667 2.667 0 0 1 21 9.667v8.666A2.667 2.667 0 0 1 18.333 21H9.667A2.667 2.667 0 0 1 7 18.333z"/><path d="M4.012 16.737A2.005 2.005 0 0 1 3 15V5a2 2 0 0 1 2-2h10c.75 0 1.158.385 1.5 1"/></svg>`;
const DOWNLOAD_ICON = `<svg ${MENU_ICON_ATTRS}><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12"/></svg>`;
const CLEAR_ICON = `<svg ${MENU_ICON_ATTRS}><path d="M19 20H8.5l-4.21-4.3a1 1 0 0 1 0-1.41l10-10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3M18 13.3 11.7 7"/></svg>`;
const DELETE_ICON = `<svg ${MENU_ICON_ATTRS}><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>`;
const LINK_REMOVE_ICON = '<svg class="link-remove-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const LINK_CONFIRM_ICON = '<svg class="link-remove-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-11"/></svg>';

function searchFieldMarkup(id, placeholder, label, value) {
  return `<div class="search-field">
    <input class="list-search" id="${id}" type="text" placeholder="${placeholder}" aria-label="${label}" autocomplete="off" spellcheck="false" value="${escapeHtml(value)}">
    <button class="search-clear" id="${id}-clear" type="button" aria-label="Clear search" title="Clear search" ${value ? '' : 'hidden'}>${SEARCH_CLEAR_ICON}</button>
  </div>`;
}

function shellMarkup(content) {
  const newLabel = state.mode === 'sessions' ? 'New session' : 'New note';
  const listActive = state.view === 'list';
  const searchActive = state.view === 'search';
  return `<div class="app-shell">
    <header class="topbar">
      <div class="tabs" role="tablist" aria-label="Tangent mode">
        <button class="tab" id="global-tab" role="tab" aria-controls="global-view" aria-selected="${state.mode === 'global'}" tabindex="${state.mode === 'global' ? '0' : '-1'}">Global</button>
        <button class="tab" id="sessions-tab" role="tab" aria-controls="sessions-view" aria-selected="${state.mode === 'sessions'}" tabindex="${state.mode === 'sessions' ? '0' : '-1'}">Sessions</button>
      </div>
      <button class="icon-button" id="new-button" type="button" aria-label="${newLabel}" title="${newLabel}">${PLUS_ICON}</button>
      <button class="icon-button${listActive ? ' is-active' : ''}" id="list-button" type="button" aria-pressed="${listActive}" aria-label="${listActive ? 'Back to editor' : 'Open list view'}" title="${listActive ? 'Back to editor' : 'Open list view'}">${listActive ? CLOSE_ICON : LIST_ICON}</button>
      <button class="icon-button${searchActive ? ' is-active' : ''}" id="search-button" type="button" aria-pressed="${searchActive}" aria-label="Search everything" title="Search everything">${SEARCH_ICON}</button>
      <button class="icon-button" id="settings-button" type="button" aria-label="Open settings" title="Settings">${SETTINGS_ICON}</button>
    </header>${content}</div>`;
}

function globalEditorMarkup() {
  const note = state.currentNote;
  return shellMarkup(`<section class="view" id="global-view" role="tabpanel" aria-label="Global note editor">
    <div class="editor-header"><div class="editor-title-row"><button class="note-title" id="note-title" type="button" title="Rename note">${escapeHtml(note.title)}</button>${itemActionsMarkup()}</div></div>
    <textarea class="note-canvas" id="note-content" aria-label="${escapeHtml(note.title)}" placeholder="Jot something down…" spellcheck="true">${escapeHtml(note.content)}</textarea>
  </section>`);
}

function globalEmptyMarkup() {
  return shellMarkup(`<section class="view" id="global-view" role="tabpanel" aria-label="Global notes empty state"><div class="empty-state">
    <h1>No notes yet</h1><p>Create a note whenever you need a clean scratchpad.</p>
    <div><button class="text-button" id="new-note-button" type="button">+ New Note</button></div>
  </div></section>`);
}

function globalListMarkup(notes) {
  const rows = notes.map((note) => `<div class="session-row" data-search="${escapeHtml(`${note.title} ${note.content}`.toLowerCase())}" data-body="${escapeHtml(note.content)}">
      <button class="session-row-main" type="button" data-note-id="${escapeHtml(note.id)}">
        <span class="note-row-title">${escapeHtml(note.title)}</span>
        <span class="note-row-meta">${relativeTime(note.updatedAt)}</span>
        <span class="note-row-snippet" hidden></span>
      </button>
      <button class="pin-button${note.pinned ? ' is-pinned' : ''}" type="button" data-pin-note-id="${escapeHtml(note.id)}" aria-label="${note.pinned ? 'Unpin' : 'Pin'} ${escapeHtml(note.title)}" aria-pressed="${Boolean(note.pinned)}" title="${note.pinned ? 'Unpin note' : 'Pin note'}"><svg class="pin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7Z" fill="${note.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"></path></svg></button>
    </div>`).join('');
  return shellMarkup(`<section class="view" id="global-view" role="tabpanel" aria-label="Global notes list">
    <header class="view-header"><button class="icon-button" id="back-button" type="button" aria-label="Back to editor" title="Back to editor">${BACK_ICON}</button><span class="view-title">Global Notes</span><button class="text-button list-new-button" id="new-note-button" type="button">+ New Note</button></header>
    <div class="list-search-row">${searchFieldMarkup('list-search', 'Search notes', 'Search notes', state.listQuery)}</div>
    <div class="note-list">${rows}<p class="list-empty" id="list-empty" hidden>No matching notes.</p></div>
  </section>`);
}

function sessionEditorMarkup() {
  const session = state.currentSession;
  const context = session.links.length === 0
    ? '<p class="context-empty">No pages recorded yet.</p>'
    : session.links.map((link) => {
        const armed = state.linkRemoveArmed === link.url;
        const label = escapeHtml(link.title || link.url);
        return `<div class="context-link-row">
        <a class="context-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
          <img class="link-favicon" src="${escapeHtml(getFaviconUrl(link.url))}" width="16" height="16" alt="">
          <span class="context-link-copy"><span class="context-link-title">${escapeHtml(link.title || link.url)}</span><span class="context-link-url">${escapeHtml(link.url)}</span></span>
        </a>
        <button class="link-remove${armed ? ' is-armed' : ''}" type="button" data-remove-link="${escapeHtml(link.url)}" aria-label="${armed ? 'Confirm remove' : 'Remove'} ${label}" title="${armed ? 'Tap again to remove' : 'Remove from context'}">${armed ? LINK_CONFIRM_ICON : LINK_REMOVE_ICON}</button>
      </div>`;
      }).join('');
  return shellMarkup(`<section class="view" id="sessions-view" role="tabpanel" aria-label="Session editor">
    <div class="editor-header session-editor-header">
      <div class="editor-title-row"><button class="note-title" id="session-title" type="button" title="Rename session">${escapeHtml(session.title)}</button>${itemActionsMarkup()}</div>
      <div class="session-metadata"><span class="session-meta-text">Created ${dateTime(session.createdAt)} · ${relativeTime(session.updatedAt)}</span>${state.recordingActive ? '<span class="session-status" role="status"><span class="recording-dot" aria-hidden="true"></span>Recording</span>' : ''}</div>
    </div>
    <textarea class="note-canvas" id="session-content" aria-label="${escapeHtml(session.title)}" placeholder="Jot something down…" spellcheck="true">${escapeHtml(session.content)}</textarea>
    <section class="session-context" aria-label="Session context">
      <button class="context-toggle" id="context-toggle" type="button" aria-controls="context-body" aria-expanded="${state.sessionContextExpanded}">${state.sessionContextExpanded ? CARET_DOWN_ICON : CARET_RIGHT_ICON}<span>Session context · ${session.links.length} links</span></button>
      <div class="context-expand" id="context-body" aria-hidden="${!state.sessionContextExpanded}"><div class="context-expand-inner"><div class="context-body">${context}</div></div></div>
    </section>
  </section>`);
}

function sessionListMarkup(sessions) {
  const rows = sessions.map((session) => {
    const body = [session.content, ...session.links.flatMap((link) => [link.title, link.url])].filter(Boolean).join(' ');
    const haystack = `${session.title} ${body}`.toLowerCase();
    return `<div class="session-row" data-search="${escapeHtml(haystack)}" data-body="${escapeHtml(body)}">
      <button class="session-row-main" type="button" data-session-id="${escapeHtml(session.id)}">
        <span class="note-row-title">${escapeHtml(session.title)}</span>
        <span class="note-row-meta">Created ${dateTime(session.createdAt)} · ${relativeTime(session.updatedAt)}</span>
        <span class="note-row-snippet" hidden></span>
      </button>
      <button class="pin-button${session.pinned ? ' is-pinned' : ''}" type="button" data-pin-session-id="${escapeHtml(session.id)}" aria-label="${session.pinned ? 'Unpin' : 'Pin'} ${escapeHtml(session.title)}" aria-pressed="${Boolean(session.pinned)}" title="${session.pinned ? 'Unpin session' : 'Pin session'}"><svg class="pin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7Z" fill="${session.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"></path></svg></button>
    </div>`;
  }).join('');
  return shellMarkup(`<section class="view" id="sessions-view" role="tabpanel" aria-label="Sessions history list">
    <header class="view-header"><button class="icon-button" id="back-button" type="button" aria-label="Back to editor" title="Back to editor">${BACK_ICON}</button><span class="view-title">Sessions</span><button class="text-button list-new-button" id="new-session-button" type="button">+ New Session</button></header>
    <div class="list-search-row">${searchFieldMarkup('list-search', 'Search sessions', 'Search sessions', state.listQuery)}</div>
    <div class="note-list">${rows}<p class="list-empty" id="list-empty" hidden>No matching sessions.</p></div>
  </section>`);
}

function sessionsEmptyMarkup() {
  return shellMarkup(`<section class="view" id="sessions-view" role="tabpanel" aria-label="Sessions empty state"><div class="empty-state">
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

  return shellMarkup(`<section class="view" id="${state.mode === 'sessions' ? 'sessions-view' : 'global-view'}" role="tabpanel" aria-label="Settings">
    <header class="view-header"><button class="icon-button" id="settings-back-button" type="button" aria-label="Back to editor" title="Back to editor">${BACK_ICON}</button><span class="view-title">Settings</span></header>
    <div class="settings-list">
      <section class="settings-item">
        <div class="settings-item-header"><label class="settings-label" for="theme-select">Theme</label><select class="settings-select" id="theme-select" aria-label="Theme"><option value="system" ${state.theme === 'system' ? 'selected' : ''}>System</option><option value="light" ${state.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>Dark</option></select></div>
      </section>
      <section class="settings-item">
        <div class="settings-item-header"><span class="settings-label">Keyboard shortcut</span><span class="settings-value">${state.shortcut ? escapeHtml(state.shortcut) : 'Not assigned'}</span></div>
        <p>${state.shortcut ? 'Chrome manages this shortcut. Change it at chrome://extensions/shortcuts.' : 'Another shortcut may already be using Tangent’s default. Assign one at chrome://extensions/shortcuts.'}</p>
      </section>
      <section class="settings-item">
        <div class="settings-item-header"><span class="settings-label">Deep Dive tracking</span><button class="settings-toggle" id="deep-dive-toggle" type="button" aria-pressed="${deepDiveActive}" ${deepDiveAvailable ? '' : 'disabled'}>${status}</button></div>
        <p>Keep recording session links even when the panel is closed. Automatically turned off while browsing in Incognito.</p>
        ${pauseControl}
      </section>
      <section class="settings-item">
        <div class="settings-item-header"><span class="settings-label">Backup &amp; restore</span></div>
        <p>Save every note and session to a JSON file, or replace all current data from a backup.</p>
        <div class="settings-actions">
          <button class="text-button" id="export-button" type="button">Export backup</button>
          <button class="text-button${state.pendingImport ? ' is-armed' : ''}" id="import-button" type="button">${state.pendingImport ? 'Confirm restore — replaces all data' : 'Import backup'}</button>
          <input class="visually-hidden" id="import-file" type="file" accept="application/json,.json" tabindex="-1" aria-hidden="true">
        </div>
        ${state.settingsNotice ? `<p class="settings-notice" role="status">${escapeHtml(state.settingsNotice)}</p>` : ''}
      </section>
    </div>
  </section>`);
}

function searchMarkup(notes, sessions) {
  const noteRows = notes.map((note) => `<button class="search-row" type="button" data-search-note-id="${escapeHtml(note.id)}" data-search="${escapeHtml(`${note.title} ${note.content}`.toLowerCase())}" data-body="${escapeHtml(note.content)}">
      <span class="search-row-title">${escapeHtml(note.title)}</span>
      <span class="search-row-meta">${relativeTime(note.updatedAt)}</span>
      <span class="search-row-snippet" hidden></span>
    </button>`).join('');
  const sessionRows = sessions.map((session) => {
    const body = [session.content, ...session.links.flatMap((link) => [link.title, link.url])].filter(Boolean).join(' ');
    const haystack = `${session.title} ${body}`.toLowerCase();
    return `<button class="search-row" type="button" data-search-session-id="${escapeHtml(session.id)}" data-search="${escapeHtml(haystack)}" data-body="${escapeHtml(body)}">
      <span class="search-row-title">${escapeHtml(session.title)}</span>
      <span class="search-row-meta">Created ${dateTime(session.createdAt)} · ${relativeTime(session.updatedAt)}</span>
      <span class="search-row-snippet" hidden></span>
    </button>`;
  }).join('');
  return shellMarkup(`<section class="view" id="search-view" role="tabpanel" aria-label="Search everything">
    <header class="view-header"><button class="icon-button" id="search-back-button" type="button" aria-label="Back to editor" title="Back to editor">${BACK_ICON}</button><span class="view-title">Search everything</span></header>
    <div class="list-search-row">${searchFieldMarkup('unified-search', 'Search all notes and sessions', 'Search all notes and sessions', state.searchQuery)}</div>
    <div class="search-results" id="search-results">
      <p class="search-hint" id="search-hint">Search across every Global note and Session at once.</p>
      <p class="list-empty" id="search-empty" hidden>No matches.</p>
      <section class="search-group" data-group hidden><h2 class="search-group-title">Global Notes</h2>${noteRows}</section>
      <section class="search-group" data-group hidden><h2 class="search-group-title">Sessions</h2>${sessionRows}</section>
    </div>
  </section>`);
}

async function showSearch() {
  await flushCurrentAutosave();
  state.view = 'search';
  state.menuOpen = false;
  state.searchQuery = '';
  disarmDelete();
  requestFocus('#unified-search');
  await render();
}

async function showGlobalEditor() {
  await autosaveSessionContent.flush();
  state.mode = 'global';
  state.view = 'editor';
  state.menuOpen = false;
  state.listQuery = '';
  disarmDelete();
  state.currentNote = await ensureInitialGlobalNote();
  await render();
}

async function showSessionEditor() {
  await autosaveGlobalContent.flush();
  state.mode = 'sessions';
  state.view = 'editor';
  state.menuOpen = false;
  state.listQuery = '';
  disarmDelete();
  state.currentSession = await getActiveSession();
  state.sessionContextExpanded = false;
  disarmLinkRemove();
  await render();
  if (state.currentSession) await captureActiveTabForSession();
}

function closeMenu({ restoreFocus = false } = {}) {
  if (!state.menuOpen) return;
  state.menuOpen = false;
  disarmDelete();
  if (restoreFocus) requestFocus('#menu-button');
  render();
}

function bindMenuKeyboard() {
  const menu = document.querySelector('#actions-menu');
  if (!menu) return;
  const items = [...menu.querySelectorAll('[role="menuitem"]')];

  items.forEach((item, index) => item.addEventListener('keydown', (event) => {
    let targetIndex = null;
    if (event.key === 'ArrowDown') targetIndex = (index + 1) % items.length;
    if (event.key === 'ArrowUp') targetIndex = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') targetIndex = 0;
    if (event.key === 'End') targetIndex = items.length - 1;
    if (targetIndex !== null) {
      event.preventDefault();
      items[targetIndex].focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    }
  }));
  menu.addEventListener('focusout', (event) => {
    // A re-render (e.g. arming delete) detaches the focused item and reports a
    // null relatedTarget; that is not a real move away, so ignore it. Only close
    // when focus genuinely lands on something outside the menu.
    const next = event.relatedTarget;
    if (next && !menu.contains(next)) closeMenu();
  });
}

function bindShell() {
  document.querySelector('#global-tab').addEventListener('click', () => {
    if (state.mode !== 'global') showGlobalEditor();
  });
  document.querySelector('#sessions-tab').addEventListener('click', () => {
    if (state.mode !== 'sessions') showSessionEditor();
  });
  document.querySelectorAll('[role="tab"]').forEach((tab) => tab.addEventListener('keydown', (event) => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(event.currentTarget);
    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (nextTab.id === 'global-tab' && state.mode !== 'global') {
      requestFocus('#global-tab');
      showGlobalEditor();
    } else if (nextTab.id === 'sessions-tab' && state.mode !== 'sessions') {
      requestFocus('#sessions-tab');
      showSessionEditor();
    } else {
      nextTab.focus();
    }
  }));
  const newButton = document.querySelector('#new-button');
  if (newButton) newButton.addEventListener('click', () => {
    createContextItem().catch((error) => console.error('Unable to create item:', error));
  });
  document.querySelector('#list-button').addEventListener('click', async () => {
    await flushCurrentAutosave();
    // The list button doubles as open/close: from the list (or settings) it
    // returns to the editor, otherwise it opens the list.
    if (state.view === 'list') {
      if (state.mode === 'global') await showGlobalEditor();
      else await showSessionEditor();
      return;
    }
    state.view = 'list';
    state.menuOpen = false;
    state.listQuery = '';
    disarmDelete();
    await render();
  });
  const menuButton = document.querySelector('#menu-button');
  if (menuButton) menuButton.addEventListener('click', () => {
    state.menuOpen = !state.menuOpen;
    if (!state.menuOpen) disarmDelete();
    else requestFocus('#copy-button');
    render();
  });
  const settingsButton = document.querySelector('#settings-button');
  if (settingsButton) settingsButton.addEventListener('click', showSettings);
  const searchButton = document.querySelector('#search-button');
  if (searchButton) searchButton.addEventListener('click', async () => {
    if (state.view === 'search') {
      await flushCurrentAutosave();
      if (state.mode === 'sessions') await showSessionEditor();
      else await showGlobalEditor();
      return;
    }
    await showSearch();
  });
  const copyButton = document.querySelector('#copy-button');
  if (copyButton) copyButton.addEventListener('click', copyCurrentItem);
  const downloadButton = document.querySelector('#download-button');
  if (downloadButton) downloadButton.addEventListener('click', downloadCurrentItem);
  const clearButton = document.querySelector('#clear-button');
  if (clearButton) clearButton.addEventListener('click', clearCurrentItem);
  const deleteButton = document.querySelector('#delete-button');
  if (deleteButton) deleteButton.addEventListener('click', handleDelete);
  bindMenuKeyboard();
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.menuOpen) {
    event.preventDefault();
    closeMenu({ restoreFocus: true });
  }
});

document.addEventListener('pointerdown', (event) => {
  if (state.menuOpen && !event.target.closest('#actions-menu, #menu-button')) closeMenu();
});

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

function disarmLinkRemove() {
  state.linkRemoveArmed = null;
  if (linkRemoveArmTimeoutId) clearTimeout(linkRemoveArmTimeoutId);
  linkRemoveArmTimeoutId = null;
}

async function handleRemoveLink(url) {
  if (state.linkRemoveArmed === url) {
    disarmLinkRemove();
    const response = await chrome.runtime.sendMessage({
      type: 'remove-session-link',
      sessionId: state.currentSession.id,
      url,
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not remove the link.');
    const updated = response.session;
    if (updated) state.currentSession = updated;
    await render();
    return;
  }
  if (linkRemoveArmTimeoutId) clearTimeout(linkRemoveArmTimeoutId);
  state.linkRemoveArmed = url;
  linkRemoveArmTimeoutId = setTimeout(() => {
    state.linkRemoveArmed = null;
    linkRemoveArmTimeoutId = null;
    if (state.mode === 'sessions' && state.view === 'editor' && state.sessionContextExpanded) render();
  }, 3000);
  await render();
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
  requestFocus('#delete-button');
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

function highlightSnippet(body, query) {
  if (!body || !query) return '';
  const lower = body.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) return '';
  const radius = 32;
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + query.length + radius);
  const collapse = (text) => text.replace(/\s+/g, ' ');
  const before = collapse(body.slice(start, idx)).replace(/^\s+/, '');
  const match = body.slice(idx, idx + query.length);
  const after = collapse(body.slice(idx + query.length, end)).replace(/\s+$/, '');
  let html = `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
  if (start > 0) html = `… ${html}`;
  if (end < body.length) html = `${html} …`;
  return html;
}

function updateRowSnippet(row, query) {
  const snippet = row.querySelector('.note-row-snippet, .search-row-snippet');
  if (!snippet) return;
  const titleEl = row.querySelector('.note-row-title, .search-row-title');
  const titleText = titleEl ? titleEl.textContent.toLowerCase() : '';
  const html = query && !titleText.includes(query) ? highlightSnippet(row.dataset.body || '', query) : '';
  snippet.innerHTML = html;
  snippet.hidden = html === '';
}

function applyListFilter() {
  const query = state.listQuery.trim().toLowerCase();
  const rows = document.querySelectorAll('[data-search]');
  let visible = 0;
  rows.forEach((row) => {
    const match = !query || row.dataset.search.includes(query);
    row.hidden = !match;
    updateRowSnippet(row, match ? query : '');
    if (match) visible += 1;
  });
  const empty = document.querySelector('#list-empty');
  if (empty) empty.hidden = visible !== 0 || query === '';
}

function bindListSearch() {
  const search = document.querySelector('#list-search');
  if (!search) return;
  const clearButton = document.querySelector('#list-search-clear');
  const syncClearButton = () => {
    if (clearButton) clearButton.hidden = search.value === '';
  };
  search.addEventListener('input', (event) => {
    state.listQuery = event.currentTarget.value;
    syncClearButton();
    applyListFilter();
  });
  if (clearButton) clearButton.addEventListener('click', () => {
    search.value = '';
    state.listQuery = '';
    syncClearButton();
    applyListFilter();
    search.focus();
  });
  syncClearButton();
  applyListFilter();
}

function applySearchFilter() {
  const query = state.searchQuery.trim().toLowerCase();
  const rows = document.querySelectorAll('#search-results [data-search]');
  let total = 0;
  rows.forEach((row) => {
    const match = query !== '' && row.dataset.search.includes(query);
    row.hidden = !match;
    updateRowSnippet(row, match ? query : '');
    if (match) total += 1;
  });
  document.querySelectorAll('#search-results [data-group]').forEach((group) => {
    const anyVisible = [...group.querySelectorAll('[data-search]')].some((row) => !row.hidden);
    group.hidden = !anyVisible;
  });
  const hint = document.querySelector('#search-hint');
  if (hint) hint.hidden = query !== '';
  const empty = document.querySelector('#search-empty');
  if (empty) empty.hidden = !(query !== '' && total === 0);
}

function bindSearch() {
  document.querySelector('#search-back-button').addEventListener('click', async () => {
    if (state.mode === 'sessions') await showSessionEditor();
    else await showGlobalEditor();
  });
  const search = document.querySelector('#unified-search');
  const clearButton = document.querySelector('#unified-search-clear');
  const syncClearButton = () => {
    if (clearButton) clearButton.hidden = search.value === '';
  };
  search.addEventListener('input', (event) => {
    state.searchQuery = event.currentTarget.value;
    syncClearButton();
    applySearchFilter();
  });
  if (clearButton) clearButton.addEventListener('click', () => {
    search.value = '';
    state.searchQuery = '';
    syncClearButton();
    applySearchFilter();
    search.focus();
  });
  document.querySelectorAll('[data-search-note-id]').forEach((button) => button.addEventListener('click', async () => {
    state.mode = 'global';
    state.currentNote = await openGlobalNote(button.dataset.searchNoteId);
    state.view = 'editor';
    state.searchQuery = '';
    await render();
  }));
  document.querySelectorAll('[data-search-session-id]').forEach((button) => button.addEventListener('click', async () => {
    state.mode = 'sessions';
    state.currentSession = await openSession(button.dataset.searchSessionId);
    state.view = 'editor';
    state.sessionContextExpanded = false;
    state.searchQuery = '';
    await render();
    await captureActiveTabForSession();
  }));
  syncClearButton();
  applySearchFilter();
}

function bindGlobalList() {
  document.querySelector('#back-button').addEventListener('click', showGlobalEditor);
  document.querySelector('#new-note-button').addEventListener('click', createAndOpenNote);
  document.querySelectorAll('[data-note-id]').forEach((button) => button.addEventListener('click', async () => {
    state.currentNote = await openGlobalNote(button.dataset.noteId);
    state.view = 'editor';
    await render();
  }));
  document.querySelectorAll('[data-pin-note-id]').forEach((button) => button.addEventListener('click', async () => {
    await toggleGlobalNotePinned(button.dataset.pinNoteId);
    await render();
  }));
  bindListSearch();
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
    if (!state.sessionContextExpanded) disarmLinkRemove();
    render();
  });
  document.querySelectorAll('.link-favicon').forEach((favicon) => {
    favicon.addEventListener('error', () => { favicon.hidden = true; });
  });
  document.querySelectorAll('[data-remove-link]').forEach((button) => button.addEventListener('click', () => handleRemoveLink(button.dataset.removeLink)));
}

async function createAndOpenSession() {
  state.currentSession = await createSession();
  state.view = 'editor';
  state.sessionContextExpanded = false;
  await render();
  await captureActiveTabForSession();
}

async function createAndOpenNote() {
  state.currentNote = await createGlobalNote();
  state.view = 'editor';
  await render();
}

async function createContextItem() {
  await flushCurrentAutosave();
  return state.mode === 'sessions' ? createAndOpenSession() : createAndOpenNote();
}

function bindSessionList() {
  document.querySelector('#back-button').addEventListener('click', showSessionEditor);
  document.querySelector('#new-session-button').addEventListener('click', createAndOpenSession);
  document.querySelectorAll('[data-session-id]').forEach((button) => button.addEventListener('click', async () => {
    state.currentSession = await openSession(button.dataset.sessionId);
    state.view = 'editor';
    state.sessionContextExpanded = false;
    await render();
    await captureActiveTabForSession();
  }));
  document.querySelectorAll('[data-pin-session-id]').forEach((button) => button.addEventListener('click', async () => {
    await toggleSessionPinned(button.dataset.pinSessionId);
    await render();
  }));
  bindListSearch();
}

function bindSessionsEmpty() {
  document.querySelector('#new-session-button').addEventListener('click', createAndOpenSession);
}

function bindGlobalEmpty() {
  document.querySelector('#new-note-button').addEventListener('click', createAndOpenNote);
}

async function showSettings() {
  if (state.mode === 'global') await autosaveGlobalContent.flush();
  else await autosaveSessionContent.flush();
  state.view = 'settings';
  state.menuOpen = false;
  clearImportState();
  await Promise.all([refreshTrackingSettings(), refreshShortcutStatus()]);
  await render();
}

function clearImportState() {
  state.pendingImport = null;
  state.settingsNotice = '';
  if (importArmTimeoutId) clearTimeout(importArmTimeoutId);
  importArmTimeoutId = null;
}

async function handleExport() {
  const payload = await exportData();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tangent-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  state.settingsNotice = 'Backup exported.';
  await render();
}

function handleImportFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    if (importArmTimeoutId) clearTimeout(importArmTimeoutId);
    try {
      const payload = JSON.parse(String(reader.result));
      validateBackupPayload(payload);
      state.pendingImport = payload;
      state.settingsNotice = 'Ready to restore. Tap Confirm to replace all current data.';
      importArmTimeoutId = setTimeout(() => {
        clearImportState();
        if (state.view === 'settings') render();
      }, 8000);
    } catch (error) {
      state.pendingImport = null;
      state.settingsNotice = error.message || 'That file could not be read as JSON.';
    }
    await render();
  };
  reader.onerror = async () => {
    state.settingsNotice = 'That file could not be read.';
    await render();
  };
  reader.readAsText(file);
}

async function confirmImport() {
  const payload = state.pendingImport;
  if (importArmTimeoutId) clearTimeout(importArmTimeoutId);
  importArmTimeoutId = null;
  state.pendingImport = null;
  try {
    await importData(payload);
    state.mode = 'global';
    state.currentNote = await ensureInitialGlobalNote();
    state.currentSession = null;
    await Promise.all([refreshTrackingSettings(), refreshShortcutStatus()]);
    state.settingsNotice = 'Backup restored.';
  } catch (error) {
    state.settingsNotice = error.message || 'Import failed.';
  }
  await render();
}

function bindSettings() {
  document.querySelector('#settings-back-button').addEventListener('click', async () => {
    clearImportState();
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
  const exportButton = document.querySelector('#export-button');
  if (exportButton) exportButton.addEventListener('click', handleExport);
  const importButton = document.querySelector('#import-button');
  const importFile = document.querySelector('#import-file');
  if (importButton && importFile) {
    importButton.addEventListener('click', () => {
      if (state.pendingImport) confirmImport();
      else importFile.click();
    });
    importFile.addEventListener('change', () => handleImportFile(importFile));
  }
}

async function render() {
  if (state.view === 'search') {
    const [notes, sessions] = await Promise.all([getGlobalNotes(), getSessions()]);
    app.innerHTML = searchMarkup(notes, sessions);
    bindShell();
    bindSearch();
  } else if (state.view === 'settings') {
    app.innerHTML = settingsMarkup();
    bindShell();
    bindSettings();
  } else if (state.mode === 'global') {
    if (state.view === 'list') {
      const notes = await getGlobalNotes();
      if (notes.length === 0) {
        app.innerHTML = globalEmptyMarkup();
        bindShell();
        bindGlobalEmpty();
      } else {
        app.innerHTML = globalListMarkup(notes);
        bindShell();
        bindGlobalList();
      }
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
    const sessions = await getSessions();
    if (sessions.length === 0) {
      app.innerHTML = sessionsEmptyMarkup();
      bindShell();
      bindSessionsEmpty();
    } else {
      app.innerHTML = sessionListMarkup(sessions);
      bindShell();
      bindSessionList();
    }
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
  if (pendingFocusSelector) {
    const selector = pendingFocusSelector;
    pendingFocusSelector = null;
    requestAnimationFrame(() => document.querySelector(selector)?.focus());
  }
}

async function initialize() {
  state.currentNote = await ensureInitialGlobalNote();
  await Promise.all([refreshTrackingSettings(), refreshShortcutStatus()]);
  await render();
}

initialize().catch((error) => {
  console.error('Unable to initialize Tangent:', error);
  app.textContent = 'Tangent could not open. Reload the extension and try again.';
});
