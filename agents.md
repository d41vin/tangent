# AGENTS.md — Tangent

Tangent is a minimal, local-first Chrome extension: a scratchpad that lives in Chrome's side panel, with two modes — **Global Notes** (freeform, multiple, unlimited) and **Sessions** (a note paired with an auto-collected, deduplicated list of pages visited while it's active).

**Full spec:** `docs/project-brief.md` — read it before writing any code if anything below is unclear or you need implementation detail. This file is a condensed pointer, not a replacement for it.

## Non-negotiable principles
- **Instant.** No spinners, no loading states for core actions.
- **Local-only.** No backend, no database, no accounts, no network calls other than Chrome's own APIs. Everything lives in `chrome.storage.local` — including Incognito windows, which share the exact same data rather than a separate silo.
- **Lightweight.** Vanilla HTML/CSS/JS only. No frameworks, no rich-text/editor libraries, no UI component libraries, no build step.
- **Autosave always.** Debounced (500ms). No manual save button, ever.
- **Utilitarian design.** Flat, monochrome, GitHub/Vercel/Swiss-inspired. Color is reserved solely for the recording indicator (`#22c55e`). No modal dialogs anywhere — destructive actions use tap-to-arm/tap-again-to-confirm instead.

## Explicit non-goals — do not build these
- Any backend, database, sync, or login
- Markdown/rich-text rendering or a formatting toolbar — plain `<textarea>` only
- Folders or tags for either note type
- Full-text search (deferred — brief Section 12)
- Note-to-link attribution/highlighting (deferred — brief Section 12)
- Any use of the `chrome.history` API — only live navigation while a session is actively recording
- More than one keyboard shortcut

## Architecture at a glance
```
tangent/
├── manifest.json
├── background/background.js
├── sidepanel/{sidepanel.html, sidepanel.css, sidepanel.js}
├── lib/{storage.js, url-utils.js, favicon.js, debounce.js}
└── icons/
```
Full data model, manifest contents, and permission rationale: `docs/project-brief.md`, Sections 5–6.

## Working style
For anything nontrivial — especially the background tracking engine and the Incognito/Deep Dive interaction — switch to read-only/plan mode first (`/approvals` or `/permissions`, depending on your Codex version) and confirm the approach before editing files. These are the parts of the brief most likely to have a subtle bug if rushed.

## Multi-session protocol
This project is built across multiple Codex sessions to keep context clean. Every session:

**At the start:**
1. Read `docs/build-plan.md` — find the next unchecked phase(s).
2. Read `docs/handoff.md` — pick up exactly where the last session left off.

**At the end:**
1. Check off completed phases in `docs/build-plan.md`.
2. Overwrite (don't append to) `docs/handoff.md` with a fresh handoff note: what was built, any decisions or deviations from the brief, known issues, and what the next session should tackle first.
3. `git add -A && git commit` with a clear message describing what was completed, then `git push`.

If a phase can't be finished cleanly in one session, commit what works, and say so plainly in the handoff note rather than leaving the repo in a broken state.