# Tangent — Build Plan

Grouped into 6 Codex sessions. Check off each phase as it's completed — this file is the single source of truth for where the project stands.

## Session 1 — Skeleton + Global Notes
- [x] Phase 1 · Scaffolding — manifest.json (incl. `commands` + `incognito` keys), folder structure, panel opens via icon click and keyboard shortcut
- [x] Phase 2 · Global Notes data layer — multiple notes, numbered titles, auto-created first note, debounced autosave, storage round-trip
- [x] Phase 3 · Global Notes List + Editor views — list icon, + New Note, switching between notes
- [x] Phase 4 · Navigation shell — Global/Sessions tabs, kebab menu shell (stubbed actions), view routing

## Session 2 — Sessions (data + UI, no tracking yet)
- [ ] Phase 5 · Sessions data layer — create/list/open sessions, numbered + timestamped titles, empty state
- [ ] Phase 6 · Sessions List + Editor views — History List (pin icons, created/edited times), editable title, recording indicator UI (visual only, no live tracking yet)

## Session 3 — Background tracking engine (the hard part)
- [ ] Phase 7 · Background tracking engine — active-tab/focused-window detection, URL cleaning denylist, dedup, appending to whichever session is currently active
- [ ] Phase 8 · Panel-open detection — port wiring for default Panel-Driven tracking mode

## Session 4 — Deep Dive + Incognito
- [ ] Phase 9 · Deep Dive mode — settings toggle, persisted pause/resume, static toolbar badge
- [ ] Phase 10 · Incognito support — `spanning` mode, runtime Deep-Dive-disable check, manual verification the panel renders correctly in an actual Incognito window

## Session 5 — Feature completion
- [ ] Phase 11 · Kebab menu full wire-up — Copy All, Download as Markdown (shared formatter), Clear Note Text, Delete (tap-to-confirm), Settings view
- [ ] Phase 12 · Favicons — `_favicon/` URL construction in the references accordion
- [ ] Phase 13 · Pinning — toggle + sort-to-top in the Sessions List view

## Session 6 — Polish + edge cases
- [ ] Phase 14 · Polish + edge-case testing — empty states, transitions, accessibility, resized-panel testing, `chrome://` filtering, refresh/back-button dedup, multi-window behavior, service worker suspend/resume, Incognito data-sharing confirmation, large-note performance, keyboard shortcut conflict check
