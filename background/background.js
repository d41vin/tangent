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

function hasPanelOpenOnActiveSession(activeSessionId) {
  return [...panelPorts.values()].some((panel) => (
    panel.mode === 'sessions' && panel.sessionId === activeSessionId
  ));
}

async function notifyPanelTrackingState() {
  const { activeSessionId, activeSession } = await getActiveSessionData();
  const recordingAllowed = Boolean(activeSession)
    && hasPanelOpenOnActiveSession(activeSessionId);

  for (const [port, panel] of panelPorts) {
    try {
      port.postMessage({
        type: 'tracking-state',
        recording: recordingAllowed
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
    if (!activeSession || !hasPanelOpenOnActiveSession(activeSessionId)) return false;
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
    runSafely('could not record completed navigation', () => recordTabIfStillFocused(tabId));
  }
});

chrome.tabs.onActivated.addListener(() => {
  runSafely('could not record activated tab', recordFocusedActiveTab);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    runSafely('could not record focused window tab', recordFocusedActiveTab);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT_NAME) return;

  panelPorts.set(port, { mode: 'global', sessionId: null });
  runSafely('could not update panel tracking state', notifyPanelTrackingState);

  port.onMessage.addListener((message) => {
    if (message?.type === 'panel-state') {
      panelPorts.set(port, {
        mode: message.mode === 'sessions' ? 'sessions' : 'global',
        sessionId: typeof message.sessionId === 'string' ? message.sessionId : null,
      });
      runSafely('could not update panel tracking state', notifyPanelTrackingState);
      return;
    }

    if (message?.type === 'capture-active-tab') {
      runSafely('could not capture active tab for new session', recordFocusedActiveTab);
    }
  });

  port.onDisconnect.addListener(() => {
    panelPorts.delete(port);
    runSafely('could not update panel tracking state', notifyPanelTrackingState);
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && (changes.activeSessionId || changes.sessions)) {
    runSafely('could not update panel tracking state', notifyPanelTrackingState);
  }
});
