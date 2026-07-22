# Tangent - Build Plan

Grouped into 6 Codex sessions. Check off each phase as it is completed - this file is the single source of truth for where the project stands.

## Session 1 - Skeleton + Global Notes
- [x] Phase 1: Scaffolding - manifest.json (including commands and incognito keys), folder structure, panel opens via icon click and keyboard shortcut
- [x] Phase 2: Global Notes data layer - multiple notes, numbered titles, auto-created first note, debounced autosave, storage round-trip
- [x] Phase 3: Global Notes List + Editor views - list icon, + New Note, switching between notes
- [x] Phase 4: Navigation shell - Global/Sessions tabs, kebab menu shell (stubbed actions), view routing

## Session 2 - Sessions (data + UI, no tracking yet)
- [x] Phase 5: Sessions data layer - create/list/open sessions, numbered + timestamped titles, empty state
- [x] Phase 6: Sessions List + Editor views - History List (with pin icons, created/edited times), editable title, recording indicator UI (visual only, no live tracking yet)

## Session 3 - Background tracking engine (the hard part)
- [x] Phase 7: Background tracking engine - active-tab/focused-window detection, URL cleaning denylist, dedup, appending to whichever session is currently active
- [x] Phase 8: Panel-open detection - port wiring for default Panel-Driven tracking mode

## Session 4 - Deep Dive + Incognito
- [x] Phase 9: Deep Dive mode - settings toggle, persisted pause/resume, static toolbar badge
- [x] Phase 10: Incognito support - spanning mode, runtime Deep-Dive-disable check, manual verification the panel renders correctly in an actual Incognito window

## Session 5 - Feature completion
- [x] Phase 11: Kebab menu full wire-up - Copy All, Download as Markdown (shared formatter), Clear Note Text, Delete (tap-to-confirm), Settings view
- [x] Phase 12: Favicons - _favicon/ URL construction in the references accordion
- [x] Phase 13: Pinning - toggle + sort-to-top in the Sessions List view

## Session 6 - Polish + edge cases
- [x] Phase 14: Polish + edge-case testing - empty states, transitions, accessibility, resized-panel testing, chrome:// filtering, refresh/back-button dedup, multi-window behavior, service worker suspend/resume, Incognito data-sharing confirmation, large-note performance, keyboard shortcut conflict check

## Session 7 - UI/UX overhaul + backup
- [x] #5: Fixed delete confirmation being dismissed by the menu focusout race
- [x] #1: Recording status shown inline with the session metadata line
- [x] #2.1: Item actions (kebab) moved to the title row; settings gear surfaced in the header
- [x] #3: Context-aware + button added to the header (order: +, list, search, settings)
- [x] #4: List button toggles between list and editor with icon change
- [x] #7: + New moved into the list back-button row
- [x] #13a: Per-tab search input in the list views
- [x] #13b: Unified cross-tab search view + header search icon
- [x] #6: Icons added to the item action menu items
- [x] #8 + #9: Context list capped at 40vh with scroll + themed scrollbars
- [x] #10: Global note pinning parity with Sessions
- [x] #11: Per-link removal in the context accordion (tap-to-confirm)
- [x] Backup/restore: JSON export + destructive import in Settings
- [ ] #12: Cross-panel live content sync - deferred, not built

## Session 8 - Icon and interaction refinement
- [x] Icon system: normalized header, navigation, context, and note-action SVGs; unified action labels; removed Chrome's native search cancel decoration; added monochrome pressed states.

## Session 9 - Search affordance and alignment pass
- [x] Added a custom monochrome search clear control and standardized icon geometry, insets, and vertical alignment across the panel.
