import { cleanUrl, shouldRecord } from '../lib/url-utils.js';

// Every event listener is registered synchronously at module evaluation time.
// Chrome can therefore wake this MV3 worker for a future tab/window event.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Unable to configure Tangent side panel:', error));

const PANEL_PORT_NAME = 'tangent-panel';
const panelPorts = new Map();
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

function hasPanelOpenOnActiveSession(activeSessionId) {
  return [...panelPorts.values()].some((panel) => (
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
  const showBadge = Boolean(activeSession)
    && !tab.incognito
    && deepDiveTracking
    && !trackingPaused
    && panelPorts.size === 0;

  await chrome.action.setBadgeText({ tabId: tab.id, text: showBadge ? '•' : '' });
  if (showBadge) {
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#22c55e' });
  }
}

async function notifyPanelTrackingState() {
  const { activeSessionId, activeSession } = await getActiveSessionData();
  for (const [port, panel] of panelPorts) {
    try {
      port.postMessage({
        type: 'tracking-state',
        recording: Boolean(activeSession)
          && panel.mode === 'sessions'
          && panel.sessionId === activeSessionId,
      });
    } catch (error) {
      // A disconnect can race this broadcast; onDisconnect performs cleanup.
      reportError('could not notify panel of tracking state', error);
    }
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'remove-session-link') return undefined;

  removeLinkFromSession(message.sessionId, message.url)
    .then((session) => sendResponse({ ok: true, session }))
    .catch((error) => {
      reportError('could not remove session link', error);
      sendResponse({ ok: false, error: 'Could not remove the link. Please try again.' });
    });
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT_NAME) return;

  panelPorts.set(port, {
    mode: 'global',
    sessionId: null,
    inIncognito: Boolean(port.sender?.tab?.incognito),
  });
  runSafely('could not update panel tracking state', notifyPanelTrackingState);
  runSafely('could not update toolbar badge', updateToolbarBadge);

  port.onMessage.addListener((message) => {
    if (message?.type === 'panel-state') {
      panelPorts.set(port, {
        mode: message.mode === 'sessions' ? 'sessions' : 'global',
        sessionId: typeof message.sessionId === 'string' ? message.sessionId : null,
        inIncognito: message.inIncognito === true,
      });
      runSafely('could not update panel tracking state', notifyPanelTrackingState);
      runSafely('could not update toolbar badge', updateToolbarBadge);
      return;
    }

    if (message?.type === 'capture-active-tab') {
      runSafely('could not capture active tab for new session', recordFocusedActiveTab);
    }
  });

  port.onDisconnect.addListener(() => {
    panelPorts.delete(port);
    runSafely('could not update panel tracking state', notifyPanelTrackingState);
    runSafely('could not update toolbar badge', updateToolbarBadge);
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.activeSessionId || changes.sessions) {
    runSafely('could not update panel tracking state', notifyPanelTrackingState);
  }

  if (changes.activeSessionId || changes.sessions || changes.settings || changes.trackingPaused) {
    runSafely('could not update toolbar badge', updateToolbarBadge);
  }

  if (changes.settings || changes.trackingPaused) {
    runSafely('could not apply changed Deep Dive setting', recordFocusedActiveTab);
  }
});
