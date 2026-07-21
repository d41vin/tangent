# Tangent - Handoff

## Status

v1 is complete. This follow-up maintenance patch fixes panel-driven tracking reliability and improves shortcut discoverability.

## What was built this session

- Changed Tangent’s suggested panel shortcut to `Ctrl+Shift+K` on Windows/Linux and `Command+Shift+K` on macOS. `Ctrl+Shift+T` was deliberately not used because Chrome reserves it for reopening closed tabs.
- Added a Keyboard shortcut row in Settings. It reads the actual command assignment from Chrome and reports either the active key or `Not assigned`, then directs users to `chrome://extensions/shortcuts` for changes. Chrome owns shortcut rebinding; Tangent does not present a misleading in-app key picker.
- Fixed Panel-Driven recording reliability. A visible Sessions panel now sends a small state heartbeat every 20 seconds. This keeps the MV3 service worker alive while recording and prevents it from losing the in-memory connected-panel state after its idle timeout.
- Reopening or entering a Session now captures the currently focused completed page after declaring that Session active. This covers opening Tangent after already landing on a page, without reading history or creating duplicates.

## Verification performed

- `node --check` passed for the side panel and background worker.
- `git diff --check` passed.
- Manifest assertion confirmed the new `Ctrl+Shift+K` / `Command+Shift+K` suggested bindings.
- A mocked background-worker integration check confirmed that a Sessions panel state message followed by the capture request appends the focused page to the active Session.

## Required manual verification

1. Reload Tangent at `chrome://extensions`. Because Chrome may preserve an existing unassigned/user-selected command, open `chrome://extensions/shortcuts` and assign `Ctrl+Shift+K` to Tangent if Settings reports `Not assigned`.
2. With Tangent closed, land on a normal web page, open the panel, switch to Sessions, and confirm the active Session receives that page exactly once.
3. Leave the Sessions panel open for more than one minute, visit several pages, and confirm all are still recorded. This specifically validates the service-worker heartbeat fix.
4. Confirm that the same URL can appear once in each separate Session, while refreshes/revisits within one Session remain deduplicated.

## Deferred follow-up

Manual JSON backup/restore is intentionally not implemented in this patch. The agreed design is one complete timestamped JSON snapshot per export and a single-file destructive restore, protected by Tangent’s tap-to-arm/tap-again confirmation pattern.

## Next session

Run the manual checks above. The next product feature, if desired, is the manual JSON export/import backup flow.
