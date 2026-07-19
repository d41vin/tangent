// Tracking listeners are intentionally added in later phases. Keeping this
// service worker small lets Chrome suspend it when the panel is idle.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Unable to configure Tangent side panel:', error));
