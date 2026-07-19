# Tangent - Handoff

## Status

Session 4 implementation is complete: Phases 9-10 are built. The required live Chrome Incognito side-panel rendering check remains for the user to perform.

## What was built this session

- Persisted Deep Dive settings in `chrome.storage.local`: `settings.deepDiveTracking` (off by default) and a separate `trackingPaused` flag. Pausing does not overwrite the user's Deep Dive preference, so it survives service-worker/browser restarts.
- A Settings view reachable from the existing kebab menu. It provides the Deep Dive toggle and, when enabled in a regular window, a Pause tracking / Resume tracking control.
- A static green toolbar badge (`dot`) while Deep Dive is actively recording with every Tangent panel closed. The badge is cleared when a panel is open, Deep Dive is paused/off, there is no active session, or the focused tab is Incognito.
- The background tracking gate now applies Deep Dive only to non-Incognito tabs. Incognito tabs always fall back to the existing visible panel-driven gate, even if the persisted Deep Dive setting is enabled and unpaused.
- In an Incognito side panel, Settings presents Deep Dive as `Off in Incognito`, disables its control, and hides the pause/resume control. The stored regular-window preference is deliberately unchanged and becomes effective again in a normal window.
- The manifest already declared `"incognito": "spanning"` from Phase 1; it remains in place for the shared background/storage architecture.

## Decisions made / deviations from the brief

- Incognito force-disable is evaluated from the live focused tab's `incognito` flag in the shared spanning service worker. This is necessary because the single service worker itself is not an Incognito-only context.
- Opening Settings from the Sessions tab retains the active-session panel state, so the existing visible panel-driven tracking continues while Settings is open. Deep Dive's toolbar badge stays hidden while any Tangent panel is open.
- Settings is the only kebab action enabled so far; the other menu actions intentionally remain stubs for Phase 11.

## Verification performed

- Ran `node --check` on `background/background.js`, `sidepanel/sidepanel.js`, and `lib/storage.js`.
- Ran `git diff --check`.
- Ran a mocked Chrome background test covering: normal Deep Dive capture with no panel, Incognito Deep Dive rejection, Incognito capture with an active Session panel, and paused normal Deep Dive rejection.

## Required manual verification

1. In `chrome://extensions`, reload Tangent, open Details, and enable **Allow in Incognito**.
2. Open an Incognito window, open Tangent's side panel from the toolbar, and verify Global Notes and Sessions render and work normally. Create a small Global Note and confirm it is visible in a normal window too (and vice versa).
3. In a normal window, enable Deep Dive in Tangent Settings. Close every Tangent side panel, visit a unique HTTP(S) page, and confirm reopening the active Session shows that page in its context. The action icon should show a static green dot while the panel is closed.
4. With that stored setting still on, in an Incognito Tangent panel open Settings and confirm it reads **Off in Incognito** and cannot be enabled or paused/resumed there. Close every Tangent panel in every window, visit a unique HTTP(S) page in Incognito, then reopen the session: that page must not have been recorded and the action icon must have no green dot.
5. Leave the Incognito Session panel open, navigate to another unique HTTP(S) page, and confirm that page is recorded. This verifies that only Deep Dive is disabled there; visible panel-driven tracking remains available.

## Next session starts here

Implement Phase 11: wire the remaining kebab actions (Copy All, Download as Markdown, Clear Note Text, and tap-to-confirm delete), while preserving the Settings view introduced in this session. Then complete Phase 12 favicons and Phase 13 pinning.
