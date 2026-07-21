# Handoff

## Status

v1 is complete. This session delivered a UI/UX overhaul plus a JSON backup/restore feature. Every approved work item was implemented and committed as an atomic conventional commit. Only #12 (cross-panel live content sync) was deliberately deferred.

## What was built this session

Header / navigation IA:
- **#2.1** — Per-item actions (`⋮` menu) moved onto the note/session title row. Settings moved out of the kebab and surfaced as a gear in the header.
- **#3** — Context-aware `+` button in the header that creates a new note (Global) or session (Sessions). Placed before the list button. Final header order: `+  ☰  🔍  ⚙`.
- **#4** — The list (`☰`) button now toggles open/close, swapping its icon (`☰` ↔ `✕`) and carrying an `.is-active` state.
- **#7** — The `+ New` action moved out of the list body into the list's back-button row (far right), freeing the old slot for per-tab search.

Editor / metadata:
- **#1** — Recording status is shown inline with the `Created … · Edited …` metadata line.
- **#5** — Fixed the delete confirmation being dismissed by a menu focusout race (delete now arms/confirms reliably).

Menu & context list:
- **#6** — Inline monochrome SVG icons added to every item-action menu row (Copy All, Download as Markdown, Clear Note Text, Delete).
- **#8 + #9** — The expanded context (references) list is capped at `40vh` with scroll, and a themed thin scrollbar was added app-wide (matches the monochrome design tokens).
- **#11** — Individual links can be removed from a session's context. The remove control is a sibling button *outside* the anchor (so tapping the row still opens the link in a new tab) and uses tap-to-arm / tap-again-to-confirm (3s timeout), monochrome — no red.

Search:
- **#13a** — Per-tab search input in both the Global and Sessions list views, sitting where `+ New` used to be. Filters rows client-side by toggling `hidden` (no re-render) so the input keeps focus. Session rows match against note title + all captured link titles/urls.
- **#13b** — A unified cross-tab search view opened from the header `🔍`. It re-skins the panel like the list toggle does, with a dedicated back button and a single query input. Results are grouped under labeled sections (Global Notes / Sessions) so the origin tab of each hit is always clear. The header search button toggles back to the editor when tapped again.

Global notes:
- **#10** — Global Notes now support pinning with full parity to Sessions: a pin toggle per row and pinned-first sort in `getGlobalNotes()`.

Backup/restore (the previously deferred follow-up, built this session):
- **Export** — Settings → "Backup & restore" writes one timestamped JSON snapshot (`{ app, version, exportedAt, data }`) via the same blob+anchor technique as "Download as Markdown". No new permissions.
- **Restore** — A single-file destructive import: validates the file is a Tangent backup, then `chrome.storage.local.clear()` + re-set. Protected by tap-to-arm / tap-again confirm (8s timeout). A `.settings-notice` reports success/errors.

## Decisions & deviations from the brief

- Unified search groups results by tab under section headers rather than tagging each row with a badge — cleaner and consistent with the utilitarian design DNA.
- All new glyphs are inline monochrome SVG (via `currentColor`), never emoji, to preserve the strict monochrome palette (green stays reserved for the recording indicator).
- Live filtering deliberately mutates the DOM (`hidden`) instead of re-rendering, to keep search instant and preserve input focus. `state.listQuery` / `state.searchQuery` persist the filter across incidental re-renders and are cleared on navigation.
- No new manifest permissions were added.

## New / changed storage API (`lib/storage.js`)

- `getGlobalNotes()` — now sorts pinned-first, then by `updatedAt` desc.
- `createGlobalNote()` — new notes include `pinned: false`.
- `toggleGlobalNotePinned(id)` — mirrors `toggleSessionPinned`.
- `removeSessionLink(id, url)` — removes a single link (dedup key is `url`).
- `exportData()` / `importData(payload)` — backup snapshot + destructive restore over `ALL_KEYS`.

## Verification performed

- `node --check` passed for `sidepanel/sidepanel.js` and `lib/storage.js`.
- `GetProblems` reported no issues on edited files.
- `git diff --check` clean; all work committed as atomic conventional commits.

## Required manual verification

1. Reload Tangent at `chrome://extensions` (load unpacked / reload).
2. Header: confirm order `+  ☰  🔍  ⚙`; `+` creates the right item per tab; `☰` toggles list/editor with icon swap; `🔍` opens and re-taps back to the editor.
3. Per-tab search: type in a list view and confirm rows filter live without losing focus; session rows match link titles/urls; empty state shows.
4. Unified search: confirm results are grouped and labeled by Global Notes / Sessions and open the correct item.
5. Global pinning: pin/unpin a global note and confirm it sorts to top and persists across reloads.
6. Per-link removal: in a session with captured pages, confirm tapping a link still opens it in a new tab, and the remove button arms then removes on second tap.
7. Context scroll: with many links, confirm the list caps at ~40vh and the themed scrollbar appears.
8. Backup round-trip: Export a JSON snapshot, make some changes, then Restore the file (arm + confirm) and verify all notes/sessions return exactly.

## Deferred

- **#12** — Cross-panel live content sync (keeping the same note/session in sync across multiple open panels) is not built.

## Next session

Run the manual checks above. If #12 is desired next, that is the remaining unchecked item in `docs/build-plan.md`.
