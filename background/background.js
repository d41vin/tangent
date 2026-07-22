import { cleanUrl, shouldRecord } from '../lib/url-utils.js';

// Every event listener is registered synchronously at module evaluation time.
// Chrome can therefore wake this MV3 worker for a future tab/window event.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Unable to configure Tangent side panel:', error));

const PANEL_STATES_KEY = 'openPanelStates';
let pendingLinkWrite = Promise.resolve();

function reportError(context, error) {
  console.error(`Tangent ${context}:`, error);
}

function runSafely(context, task) {
  task().catch((error) => reportError(context, error));
}

function queueLinkWrite(task) {
  pendingLinkWrite = pendingLinkWrite
    .catch(() => undefined)
    .then(task);
  return pendingLinkWrite;
}

async function getActiveSessionData() {
  const { sessions = {}, activeSessionId = null } = await chrome.storage.local.get([
    'sessions',
    'activeSessionId',
  ]);
  return { sessions, activeSessionId, activeSession: sessions[activeSessionId] ?? null };
}

async function getTrackingSettings() {
  const { settings = {}, trackingPaused = false } = await chrome.storage.local.get([
    'settings',
    'trackingPaused',
  ]);
  return {
    deepDiveTracking: Boolean(settings.deepDiveTracking),
    trackingPaused: Boolean(trackingPaused),
  };
}

async function getOpenPanelStates() {
  const [contexts, { [PANEL_STATES_KEY]: savedStates = {} }] = await Promise.all([
    chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }),
    chrome.storage.session.get(PANEL_STATES_KEY),
  ]);
  const openDocumentIds = new Set(contexts
    .map((context) => context.documentId)
    .filter((documentId) => typeof documentId === 'string'));
  const openStates = Object.fromEntries(Object.entries(savedStates)
    .filter(([documentId]) => openDocumentIds.has(documentId)));

  // A side panel can disappear without a final message. Chrome's live context
  // list is authoritative, so discard those stale session-only entries.
  if (Object.keys(openStates).length !== Object.keys(savedStates).length) {
    await chrome.storage.session.set({ [PANEL_STATES_KEY]: openStates });
  }
  return openStates;
}

async function setPanelState(sender, message) {
  const documentId = sender.documentId;
  if (typeof documentId !== 'string') return false;

  const { [PANEL_STATES_KEY]: savedStates = {} } = await chrome.storage.session.get(PANEL_STATES_KEY);
  await chrome.storage.session.set({
    [PANEL_STATES_KEY]: {
      ...savedStates,
      [documentId]: {
        mode: message.mode === 'sessions' ? 'sessions' : 'global',
        sessionId: typeof message.sessionId === 'string' ? message.sessionId : null,
      },
    },
  });
  return true;
}

async function hasPanelOpenOnActiveSession(activeSessionId) {
  const panelStates = await getOpenPanelStates();
  return Object.values(panelStates).some((panel) => (
    panel.mode === 'sessions' && panel.sessionId === activeSessionId
  ));
}

async function isTrackingAllowed(tab, activeSessionId, activeSession) {
  if (!activeSession) return false;

  const { deepDiveTracking, trackingPaused } = await getTrackingSettings();
  // A spanning service worker handles both profiles, so use the tab's live
  // Incognito flag instead of the worker's own extension context.
  if (!tab.incognito && deepDiveTracking && !trackingPaused) return true;

  return hasPanelOpenOnActiveSession(activeSessionId);
}

async function updateToolbarBadge() {
  if (!chrome.action) return;

  const tab = await getFocusedActiveTab();
  if (!tab) return;

  const { activeSession } = await getActiveSessionData();
  const { deepDiveTracking, trackingPaused } = await getTrackingSettings();
  const panelStates = await getOpenPanelStates();
  const showBadge = Boolean(activeSession)
    && !tab.incognito
    && deepDiveTracking
    && !trackingPaused
    && Object.keys(panelStates).length === 0;

  await chrome.action.setBadgeText({ tabId: tab.id, text: showBadge ? '•' : '' });
  if (showBadge) {
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#22c55e' });
  }
}

async function getFocusedActiveTab() {
  const focusedWindow = await chrome.windows.getLastFocused();
  if (!focusedWindow || focusedWindow.id === chrome.windows.WINDOW_ID_NONE) return null;

  const [tab] = await chrome.tabs.query({ active: true, windowId: focusedWindow.id });
  if (!tab || tab.status !== 'complete') return null;
  return tab;
}

async function getFocusedActiveTabById(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || tab.status !== 'complete') return null;

  const focusedWindow = await chrome.windows.getLastFocused();
  if (!focusedWindow || focusedWindow.id !== tab.windowId) return null;
  return tab;
}

async function appendFocusedTabToActiveSession(tab) {
  if (!tab?.url) return false;

  const cleanedUrl = cleanUrl(tab.url);
  if (!cleanedUrl) return false;

  return queueLinkWrite(async () => {
    const { sessions, activeSessionId, activeSession } = await getActiveSessionData();
    if (!await isTrackingAllowed(tab, activeSessionId, activeSession)) return false;
    if (!shouldRecord(activeSession, cleanedUrl)) return false;

    const now = Date.now();
    const link = {
      url: cleanedUrl,
      title: tab.title?.trim() || cleanedUrl,
      visitedAt: now,
    };
    const updatedSession = {
      ...activeSession,
      links: [...(activeSession.links ?? []), link],
      updatedAt: now,
    };

    await chrome.storage.local.set({
      sessions: { ...sessions, [activeSessionId]: updatedSession },
    });
    return true;
  });
}

async function removeLinkFromSession(sessionId, url) {
  if (typeof sessionId !== 'string' || typeof url !== 'string') return null;

  return queueLinkWrite(async () => {
    const { sessions } = await getActiveSessionData();
    const existing = sessions[sessionId];
    if (!existing) return null;

    const links = (existing.links ?? []).filter((link) => link.url !== url);
    const updatedSession = { ...existing, links, updatedAt: Date.now() };
    await chrome.storage.local.set({
      sessions: { ...sessions, [sessionId]: updatedSession },
    });
    return updatedSession;
  });
}

async function recordFocusedActiveTab() {
  const tab = await getFocusedActiveTab();
  return appendFocusedTabToActiveSession(tab);
}

async function recordTabIfStillFocused(tabId) {
  const tab = await getFocusedActiveTabById(tabId);
  return appendFocusedTabToActiveSession(tab);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    runSafely('could not record completed navigation', async () => {
      await recordTabIfStillFocused(tabId);
      await updateToolbarBadge();
    });
  }
});

chrome.tabs.onActivated.addListener(() => {
  runSafely('could not record activated tab', async () => {
    await recordFocusedActiveTab();
    await updateToolbarBadge();
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    runSafely('could not record focused window tab', async () => {
      await recordFocusedActiveTab();
      await updateToolbarBadge();
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'panel-state') {
    setPanelState(sender, message)
      .then(async (registered) => {
        const { activeSessionId, activeSession } = await getActiveSessionData();
        const recording = registered
          && Boolean(activeSession)
          && message.mode === 'sessions'
          && message.sessionId === activeSessionId;
        await updateToolbarBadge();
        sendResponse({ ok: true, recording, sessionId: message.sessionId ?? null });
      })
      .catch((error) => {
        reportError('could not update panel state', error);
        sendResponse({ ok: false, recording: false, sessionId: message.sessionId ?? null });
      });
    return true;
  }

  if (message?.type === 'capture-active-tab') {
    runSafely('could not capture active tab for new session', recordFocusedActiveTab);
    return undefined;
  }

  if (message?.type !== 'remove-session-link') return undefined;

  removeLinkFromSession(message.sessionId, message.url)
    .then((session) => sendResponse({ ok: true, session }))
    .catch((error) => {
      reportError('could not remove session link', error);
      sendResponse({ ok: false, error: 'Could not remove the link. Please try again.' });
    });
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.activeSessionId || changes.sessions || changes.settings || changes.trackingPaused) {
    runSafely('could not update toolbar badge', updateToolbarBadge);
  }

  if (changes.settings || changes.trackingPaused) {
    runSafely('could not apply changed Deep Dive setting', recordFocusedActiveTab);
  }
});
