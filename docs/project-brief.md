# Tangent — Chrome Extension Project Brief (v2)

*A minimal, local-first scratchpad with context-aware research sessions, living in Chrome's Side Panel.*

## 1. Product Philosophy & Core DNA

Tangent is a note-taking extension for people who think *while* they browse — debugging a bug, researching a purchase, planning a trip, reading docs — and want a place to jot things down without breaking flow or losing track of what they were looking at.

Every design and technical decision below is filtered through five non-negotiable principles:

1. **Instant.** Opening the panel, switching modes, and saving notes must feel like there's zero latency. No spinners, no loading states for core actions.
2. **Local-only.** No backend, no database, no accounts, no auth, no network calls, no cloud sync. Everything lives in the browser via `chrome.storage.local` — and that includes Incognito windows, which share the exact same local data rather than starting a separate silo (see Section 4.5).
3. **Lightweight.** Vanilla HTML/CSS/JS. No frontend framework, no rich-text editor library, no heavy dependencies. The whole point is that this never shows up in a "why is my browser slow" investigation.
4. **Ephemeral by design, reliable in practice.** This is a scratchpad, not an archive — but a scratchpad the user can never accidentally lose data from. Autosave always. No manual "Save" button, ever.
5. **Utilitarian, not decorative.** Visual language borrows from GitHub, Vercel, and Swiss design: flat, monochrome, hairline borders, generous whitespace, content-first. It also borrows its *interaction model* from AI coding tools (Claude Code, Warp, Copilot) — a focused workspace with collapsible "context" tucked out of the way until you need it.

---

## 2. Scope

### In scope (v1)
- Chrome Side Panel UI with two modes: **Global Notes** and **Sessions**
- Global Notes: **multiple** persistent, freely creatable notes, no tracking, no folders
- Sessions: notes bound to an auto-collected, deduplicated list of pages visited while the session is active
- Session and Global Note history — both browsable via a simple List view, both editable, sessions re-openable and resumable
- Sequential numbering for both Sessions and Global Notes (survives deletion of other items)
- Session pinning in the history list
- Plain-text editing only — no rich text, no Markdown rendering, no formatting toolbar
- Debounced autosave for all text content
- Kebab menu: Copy All, Download as Markdown, Clear Note Text, Delete, Settings
- Settings: theme (system/light/dark), Deep Dive tracking toggle
- Favicons next to each link in the Session references accordion
- One keyboard shortcut: toggle the side panel open/closed
- Full support for Incognito mode, opt-in via Chrome's own extension settings, sharing the exact same data as normal mode
- Manifest V3, vanilla JS, zero external runtime dependencies

### Explicitly out of scope (v1)
- Any backend, database, sync, or login
- Markdown/rich-text rendering or a formatting toolbar
- Folders or tags for either note type
- Full-text search across notes (strong fast-follow candidate — see Section 12)
- Note-to-link attribution / highlighting which part of a note was written on which site (deferred — see Section 12 for why, and for the lighter alternative worth considering later)
- Per-session override of Deep Dive mode (one global setting applies to whichever session is active)
- Additional keyboard shortcuts beyond the one (add more once real usage shows what's actually wanted)
- Any use of the `chrome.history` API — Tangent only ever observes *live* navigation while a session is actively recording, never reads past browsing history

Keep this list visible to whoever (human or AI) is building this. The biggest risk to a project like this is well-meaning scope creep that turns a fast scratchpad into a bloated notes app.

---

## 3. Information Architecture

Both note types now share the same shape — a List view and an Editor view — which turned out to be a nice side effect of adding multiple Global Notes: the two tabs now feel like the same interaction pattern applied twice, once without link-tracking and once with it.

```
Side Panel
│
├── Header (persistent across both modes)
│     [ Global ]  [ Sessions ]              ☰ (list view)  ⋮ (kebab)
│
├── GLOBAL mode
│     ├── Editor view   (default landing — whichever note was last open)
│     └── List view     (reached via ☰ — all Global Notes, "+ New Note")
│
└── SESSIONS mode
      ├── Empty state   (no sessions exist yet — "+ New Session")
      ├── Editor view    (default landing — whichever session was last open/active)
      └── List view      (reached via ☰ — all sessions, pinned first, "+ New Session")
```

**On "last open" as the default landing view:** opening either tab drops you straight into whatever you were last working on, not a list you have to click through. This was a deliberate choice from the original brief for Sessions, and extending the same rule to Global Notes keeps both tabs behaviorally identical — one interaction pattern to learn, applied consistently.

---

## 4. Feature Specifications

### 4.1 Global Notes

- **Multiple notes, flat list, no organization features** — no folders, no tags, no colors. If it starts feeling like Google Keep, it's gone too far; the point is speed, not organization.
- **Auto-created first note:** on first-ever use, Tangent creates "Note 1" automatically and lands the user directly in it, so a brand-new user never has to make a decision or see an empty list before they can start typing. This preserves the "zero friction, just start typing" quality that made the original single-scratchpad idea good, while still allowing more notes whenever wanted.
- **Sequential numbering:** each note is titled `Note {n}` at creation (n = a counter that only ever increases, never reused after a deletion — see Section 5). Tapping a title makes it editable; edits save on blur/Enter.
- **No timestamp suffix on the title** (unlike Sessions — see 4.2). Global Notes are lightweight scratch content; keeping titles short (`Note 3` rather than `Note 3 — Jul 2, 4:10 PM`) fits that better. This is a judgment call, not a hard requirement — trivial to add the same suffix Sessions use if you'd rather have it for consistency.
- **List view** shows each note's title and a relative last-edited time, sorted by most recently edited first. Tapping a note opens it in the Editor and makes it the "last open" note (so reopening the Global tab returns here next time).
- **No URL tracking of any kind** in this mode — this boundary is what keeps Global and Sessions conceptually distinct: Global is *content*, Sessions are *content + context*.
- **Deleting a note** uses the same tap-to-arm / tap-again-to-confirm pattern as Sessions (see 4.2) rather than a modal dialog.
- Autosaves via debounce (see 6.3), identically to before.

### 4.2 Sessions

**Concept:** a session pairs a free-text note with an automatically collected, deduplicated list of pages visited while that session is recording. The note is the "prompt"; the link list is the "context" — same mental model as an AI IDE attaching files/terminal output to your conversation.

#### Lifecycle
- **Starting a session:** tapping **`+ New Session`** creates a new session, makes it the active one, and starts recording immediately (if tracking conditions are met — see below).
- **Re-opening any session makes it active.** This replaced an earlier, overcomplicated draft of this rule (originally, only a freshly created session could ever be "active," and viewing an older one wouldn't resume tracking into it). The simpler rule is more intuitive and, on reflection, is actually less code, not more: whichever session is currently open in the Editor *is* the active one, full stop, whether it was just created or reopened from history. New links append to whichever session you currently have open. Only one session is ever active at a time — consistent with the multi-window rule below, whichever session was most recently opened in *any* panel instance wins globally.
- **Sequential numbering + timestamp:** default title is `Session {n} — {Mon D, h:mm AM/PM}` (e.g. `Session 3 — Jul 2, 9:10 AM`), where `n` is a counter that only ever increases and is never reused after a deletion — session 5 gets deleted, the next new session is still session 6. Tapping the title makes it editable; edits save on blur/Enter. Note that display order in the List view (by pin status, then recency) is independent of this number — a session's number is an identity label, not a sort key, so numbers won't necessarily appear in order top-to-bottom in the list.
- **Created/edited timestamps:** both are stored (`createdAt`/`updatedAt`) and shown in the Editor itself (a small metadata line, e.g. "Created Jul 2 · Edited 4 days ago"), not just as relative time in the List view.
- **Pinning:** each session can be pinned from the List view (a small pin icon per row, tap to toggle — non-destructive, no confirmation needed). Pinned sessions sort above all others in the List view; among pinned and among unpinned, sort by most recently edited.
- **Deleting a session:** tap-to-arm / tap-again-to-confirm (the delete icon turns into a confirm checkmark for ~3 seconds), available from the kebab menu inside the session's Editor or as a small action on its List row.

#### Tracking rules

| Mode | Behavior | Indicator |
|---|---|---|
| **Default — Panel-Driven** | Recording happens only while a Tangent side panel instance is open *somewhere*, showing the Sessions tab, on the currently active session. Closing all open panel instances pauses recording automatically; reopening on the active session silently resumes it. | Green pulsing dot + "Recording" text in the Editor header, only while actually recording. Cheap to animate since it's plain CSS running in a page that's already open. |
| **Deep Dive (opt-in, in Settings)** | Recording continues even while the panel is fully closed, across browser restarts, until explicitly paused. Needs an explicit **Pause / Resume tracking** button (shown only when Deep Dive is on). **Force-disabled while running inside an Incognito window** regardless of the stored setting — see 4.5. | Static (not animated) colored badge dot on the toolbar icon, shown only while recording *with the panel closed* — redundant otherwise, since the in-panel indicator already shows it. Static rather than pulsing deliberately: animating a toolbar badge reliably would mean keeping a recurring timer alive in the background service worker, fighting the exact resource-suspension behavior that keeps this extension light. |

#### What gets recorded, and how it's cleaned
Unchanged from the original design — still the right approach:
1. Scope to the tab that's both active and in the focused window, only once it finishes loading.
2. Ignore non-content URLs (`chrome://`, `chrome-extension://`, `about:`, new-tab pages).
3. Strip known tracking parameters via a denylist, not all query parameters (stripping everything would break URLs like `youtube.com/watch?v=...`, where the entire page identity lives in the query string).
4. Block consecutive duplicates (refresh/back-button spam).
5. One entry per URL per session, full stop — revisiting a site later doesn't re-add it.

See Section 7 for the exact mechanics.

#### Session editor UI
- **References accordion:** collapsed by default, labeled `Session context · {n} links`. Expands to show each entry as a small favicon, a title (sans-serif), and its URL beneath (muted, monospace) — see 4.7 for how the favicon is fetched.
- **Clicking a link always opens it in a new tab** rather than trying to find and refocus a matching open tab — by the time someone revisits an old session, the original tab is almost always long closed.

### 4.3 Kebab Menu (⋮)

Always in the top-right of the header, next to the list-view icon. Contents are context-sensitive:

| Item | Global Notes Editor | Session Editor |
|---|---|---|
| Copy All | ✅ — copies raw note text | ✅ — copies note text **plus** a formatted link list |
| Download as Markdown | ✅ — downloads the note as a `.md` file | ✅ — downloads note text **plus** the link list, formatted as real Markdown links |
| Clear Note Text | ✅ — wipes this note's text | ✅ — wipes just this session's text, keeps the link list intact |
| Delete Note / Delete Session | ✅ | ✅ |
| Settings | ✅ | ✅ |

**Shared format for Copy All and Download as Markdown** (one formatting function powers both, to avoid maintaining two versions):
```
{note text}

—
Links:
1. [{title}]({url})
2. [{title}]({url})
```
Global Notes just copy/download the raw text — no link section. Using real Markdown link syntax in the exported list is a small, easy upgrade over plain "title — url" text, and worth doing now that it's an actual `.md` file that might get opened in something that renders Markdown (Obsidian, GitHub, etc).

**Download mechanics:** a Blob + a temporary `<a download>` element, clicked programmatically — no `chrome.downloads` permission needed, since this is a standard web platform trick that works in any extension page. Filename derived from the note/session title, sanitized for filesystem-safe characters (e.g. `session-3-debugging-css-grid.md`).

### 4.4 Settings

Reached via the kebab menu, opens as its own simple view (back arrow to return):

- **Theme:** System / Light / Dark (defaults to System, i.e. follows OS via `prefers-color-scheme`)
- **Deep dive tracking:** off by default. Helper copy: *"Keep recording session links even when the panel is closed. Automatically turned off while browsing in Incognito."*

Keyboard shortcuts are **not** configured here — Chrome manages extension shortcuts itself at `chrome://extensions/shortcuts`, and duplicating that inside Tangent's own settings would just be redundant UI.

### 4.5 Incognito Mode

Tangent is designed to behave identically in Incognito windows — same notes, same sessions, nothing siloed — because that's simply how `chrome.storage.local` already works once Incognito access is granted; it's confirmed, shared storage, not something built specially for this.

- **Not requested by default.** Like any extension, Tangent won't run in Incognito at all until the user explicitly flips "Allow in Incognito" for it in `chrome://extensions`. Nothing inside Tangent's own UI should prompt for or explain this — it's entirely Chrome's own settings surface.
- **Manifest declares `"incognito": "spanning"`** (see Section 6) — a single shared background context handling both regular and Incognito windows, rather than two separate instances. This is the architecture that matches "just works, no separate anything," and is the right fit here since Tangent has no content scripts and injects nothing into pages — it only hosts its own side panel and reads tab metadata, which is exactly the case Chrome's docs point toward spanning mode for.
- **Deep Dive tracking is force-disabled while running inside an Incognito window**, regardless of the stored setting — checked live via `chrome.extension.inIncognitoContext` (or the `incognito` flag already present on tab/window objects), not a separate persisted setting. Reasoning: Incognito is the mode people specifically reach for to have nothing running silently in the background. Panel-driven tracking is fine there since it's visibly happening (the user opened the panel themselves); Deep Dive's entire premise — continuing after the panel closes — cuts directly against that expectation.
- **One thing to verify empirically, early in the build:** confirm the side panel actually renders and behaves correctly inside an Incognito window under spanning mode. Chrome's documentation describes spanning's one limitation in terms of "loading extension pages into the main frame of an incognito tab" — which likely doesn't apply to the side panel (it isn't tab content, it's a separate UI surface), but this exact intersection isn't something spelled out explicitly in Chrome's docs. This is a five-minute manual check, not a redesign risk — if it doesn't work under spanning, `"split"` is the documented fallback, and the user-facing outcome (identical notes across both modes) is unaffected either way, since that part depends only on storage sharing, not on spanning vs. split.

No new data-model fields are needed for any of this — it's a manifest key plus a couple of runtime checks, which is a nice validation that the storage-first architecture already established (Section 6.5 — never trust in-memory state, always read from `chrome.storage`) was the right call from the start.

### 4.6 Keyboard Shortcut

One shortcut in v1: toggles the side panel open/closed. Implemented as a `suggested_key` binding on the reserved `_execute_action` command — since `setPanelBehavior({ openPanelOnActionClick: true })` already makes clicking the toolbar icon toggle the panel, binding the same reserved command to a shortcut gets identical toggle behavior for free, with no custom logic needed in `background.js`. Chrome allows up to four suggested shortcuts total across an extension; this uses exactly one, leaving headroom if more get added later based on real usage.

### 4.7 Favicons in the References Accordion

Each link entry in a session's references accordion shows a small favicon before its title. This uses Chrome's dedicated MV3 favicon mechanism rather than trusting a page-supplied `favIconUrl` (which can be unreliable or go stale) — it's constructed at render time from the stored URL, so **no new data is stored per link**:

```js
function getFaviconUrl(pageUrl, size = 16) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', size.toString());
  return url.toString();
}
```

Requires the `"favicon"` permission in the manifest (see Section 6.4) — worth knowing that this permission only shows a warning to users if `tabs` or host permissions haven't already been granted, and Tangent already requests `tabs`, so this adds **zero new user-facing permission warnings**.

---

## 5. Data Model

All data lives under a small number of keys in `chrome.storage.local`. Both Global Notes and Sessions are stored as **objects keyed by ID** (not arrays) so individual reads/writes are O(1); display order is derived by sorting at render time rather than maintained as a separate ordered list.

```json
{
  "globalNotes": {
    "note_a1b2c3": {
      "id": "note_a1b2c3",
      "number": 1,
      "title": "Note 1",
      "titleIsCustom": false,
      "content": "Phone number for the dentist: 555-0142",
      "createdAt": 1750500000000,
      "updatedAt": 1750500300000
    }
  },
  "nextGlobalNoteNumber": 2,
  "lastOpenGlobalNoteId": "note_a1b2c3",

  "sessions": {
    "session_8f2a1c": {
      "id": "session_8f2a1c",
      "number": 3,
      "title": "Session 3 — Jul 2, 9:10 AM",
      "titleIsCustom": false,
      "content": "Turned out to be a flexbox issue. Need to remember the gap property.",
      "createdAt": 1751446200000,
      "updatedAt": 1751446500000,
      "pinned": false,
      "links": [
        {
          "url": "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Grid_Layout",
          "title": "CSS Grid Layout - MDN Web Docs",
          "visitedAt": 1751446300000
        },
        {
          "url": "https://css-tricks.com/snippets/css/complete-guide-grid",
          "title": "A Complete Guide to Grid - CSS-Tricks",
          "visitedAt": 1751446400000
        }
      ]
    }
  },
  "nextSessionNumber": 4,
  "activeSessionId": "session_8f2a1c",

  "settings": {
    "theme": "system",
    "deepDiveTracking": false
  },

  "trackingPaused": false
}
```

Notes on fields:
- `nextGlobalNoteNumber` / `nextSessionNumber` — persistent counters, incremented on creation, **never** decremented or reused when an item is deleted. This is what makes "Session 6" always mean the 6th session ever created, regardless of what's since been deleted.
- `lastOpenGlobalNoteId` — purely a "what to show by default" pointer for Global Notes, deliberately named differently from `activeSessionId` since it carries no functional/tracking meaning the way an active session does.
- `activeSessionId` — now means "whichever session is currently open in an editor" (updated semantics from the original draft — see Section 11), not "whichever was most recently created."
- `titleIsCustom` — lets the UI know a title has been manually renamed, in case any future logic needs to avoid overwriting a custom title with an auto-generated one.
- No favicon data is stored anywhere — favicons are derived at render time from each link's existing `url` field (see 4.7).
- `trackingPaused` only has meaning when `settings.deepDiveTracking` is `true`.

---

## 6. Technical Architecture

### 6.1 Stack
Manifest V3, vanilla HTML/CSS/JavaScript. No build step required. No frameworks, no rich-text/editor libraries, no UI component libraries.

### 6.2 File structure
```
tangent/
├── manifest.json
├── background/
│   └── background.js          (service worker: tracking engine, badge, message/port handling)
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js            (UI logic, view routing across Global/Sessions List+Editor/Settings)
├── lib/
│   ├── storage.js              (thin async wrapper over chrome.storage.local)
│   ├── url-utils.js            (tracking-param denylist, cleaning, dedup helpers)
│   ├── favicon.js               (favicon URL construction — see 4.7)
│   └── debounce.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### 6.3 manifest.json

```json
{
  "manifest_version": 3,
  "name": "Tangent",
  "version": "1.0.0",
  "description": "A minimal, local-only scratchpad with context-aware research sessions, in Chrome's side panel.",
  "minimum_chrome_version": "116",
  "incognito": "spanning",
  "permissions": [
    "sidePanel",
    "storage",
    "unlimitedStorage",
    "tabs",
    "favicon"
  ],
  "background": {
    "service_worker": "background/background.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "action": {
    "default_title": "Open Tangent"
  },
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+Y",
        "mac": "Command+Shift+Y"
      },
      "description": "Toggle the Tangent side panel"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

In `background.js`, configure the panel to open on the toolbar icon click:
```js
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));
```

*(The suggested default shortcut above is just a placeholder — pick anything unclaimed; Chrome will flag it at load time if it conflicts with something else, and the user can always rebind it at `chrome://extensions/shortcuts`.)*

### 6.4 Permissions rationale

| Permission | Why it's needed |
|---|---|
| `sidePanel` | Hosts the persistent UI in Chrome's side panel |
| `storage` | Read/write all notes, sessions, and settings locally |
| `unlimitedStorage` | Removes the default storage cap so long-running notes/sessions never hit a wall |
| `tabs` | Required to read the **URL and title** of the active tab. This is the one permission whose install-time warning ("read your browsing history") looks more alarming than what the extension actually does — worth being explicit about in the store listing, since nothing ever leaves the device. |
| `favicon` | Enables the MV3 `_favicon/` mechanism (see 4.7). Only shows a warning if `tabs` or host permissions aren't already granted — since `tabs` is already requested here, this adds no new user-facing warning. |

Deliberately **not requested:** `host_permissions`/`<all_urls>` (no content scripts, no page injection needed) and `history` (only live navigation events are observed, never past browsing history). Note also that `commands` doesn't require a separate entry in the `permissions` array — it's its own top-level manifest key.

### 6.5 MV3 service worker lifecycle

In Manifest V3, the background service worker is **not persistent** — Chrome can terminate it after roughly 30 seconds of inactivity and wake it back up on the next relevant event. Any plain JS variable used as in-memory state (e.g. "is the panel currently open") can vanish without warning. Two concrete implications:

1. **Deep Dive mode is the easier case**, because it only depends on `activeSessionId` and `settings.deepDiveTracking`/`trackingPaused`, all persisted in `chrome.storage.local` and therefore durable across worker restarts — as long as listeners (`chrome.tabs.onUpdated`, `chrome.tabs.onActivated`, etc.) are registered at the **top level** of `background.js`, Chrome will wake the worker to fire them even after suspension.
2. **Default Panel-Driven mode is trickier**, since it depends on a live signal ("is a side panel instance currently open anywhere?"). The reliable pattern: the side panel page opens a long-lived connection via `chrome.runtime.connect()` the moment it loads; the background script tracks connected ports in memory, removing them on `port.onDisconnect`. A connected port also keeps the service worker alive for as long as the panel stays open. Treat "at least one port currently connected" as ground truth for "recording is allowed" — don't persist this to storage, since a freshly-restarted worker with zero connected ports *is* an accurate "panel is closed" state.

This same storage-first discipline is also what makes Incognito support (4.5) safe without a redesign — see 6.6.

### 6.6 Incognito architecture notes

`"incognito": "spanning"` means one background context handles events from both regular and Incognito windows, each tagged with an `incognito` flag so the code can tell them apart when needed (e.g., the Deep Dive override in 4.5). Because the tracking engine already reads all of its state from `chrome.storage` rather than trusting in-memory globals (6.5), there's no meaningful extra complexity here — the same logic that correctly handles multiple windows already extends correctly to Incognito windows without modification.

### 6.7 Multi-window behavior

Unchanged: treat "panel open" as a single global boolean — true if *any* window currently has a Tangent panel open — rather than tracking per-window state. Tracking for the active session is based on whichever tab is active in whichever window currently has OS focus, regardless of which window the panel happens to be open in, and regardless of whether that window is regular or Incognito.

---

## 7. Background Tracking Engine — Implementation Details

### 7.1 Active-tab-only scoping
Use `chrome.tabs.onActivated`, `chrome.windows.onFocusChanged`, and `chrome.tabs.onUpdated` (filtering for `changeInfo.status === 'complete'`) to track only the tab the user is actually looking at. A tab loading silently in the background that the user never switches to should **not** show up in the session's link list.

### 7.2 URL cleaning — denylist, not strip-everything

```js
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'twclid', 'igshid',
  'mc_cid', 'mc_eid', 'ref', 'ref_src', 'ref_url', '_ga', '_gl', 'si', 'spm'
];

function cleanUrl(rawUrl) {
  const url = new URL(rawUrl);
  TRACKING_PARAMS.forEach((param) => url.searchParams.delete(param));
  url.hash = ''; // drop fragments by default (anchors/tracking, not page identity)
  return url.toString();
}
```

(Hash-stripping is a reasonable v1 simplification; some single-page apps encode real navigation state in the fragment, which would be a future refinement, not a v1 blocker.)

### 7.3 Deduplication

```js
function shouldRecord(session, cleanedUrl) {
  const lastEntry = session.links[session.links.length - 1];
  if (lastEntry && lastEntry.url === cleanedUrl) return false;       // consecutive duplicate
  if (session.links.some((l) => l.url === cleanedUrl)) return false;  // already in this session
  return true;
}
```

### 7.4 Recording gate (Deep Dive + Incognito interaction)

```js
async function isTrackingAllowed() {
  const { settings, trackingPaused } = await storage.get(['settings', 'trackingPaused']);
  if (chrome.extension.inIncognitoContext) {
    return isPanelOpenOnActiveSession(); // Deep Dive never applies in Incognito
  }
  if (settings.deepDiveTracking) return !trackingPaused;
  return isPanelOpenOnActiveSession();
}
```

---

## 8. Design System

### 8.1 Visual language
Flat, monochrome, content-first. Reference points: GitHub's UI, Vercel's dashboard/marketing site, Swiss/International Typographic Style. Borrow the *interaction* feel of AI coding tools: a focused primary canvas with secondary context tucked into a collapsible, low-visual-weight accordion.

### 8.2 Typography
- **UI chrome** (tabs, labels, buttons, link titles): Inter, falling back to the system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif`).
- **Note canvas**: same Inter/system stack — these are personal notes, not code, so a humanist sans-serif reads more comfortably than monospace.
- **URLs inside the references accordion**: a monospace stack (`ui-monospace, "SF Mono", "Cascadia Code", monospace`), muted gray, with the page title above it in the regular sans-serif.

### 8.3 Color tokens

**Light:**
| Token | Value |
|---|---|
| Background | `#ffffff` / `#fafafa` |
| Primary text | `#18181b` |
| Secondary/muted text | `#71717a` |
| Borders / dividers | `#e5e5e5` |
| Recording accent | `#22c55e` (green — used *only* for the recording indicator, nowhere else) |

**Dark:**
| Token | Value |
|---|---|
| Background | `#0a0a0a` / `#111111` |
| Primary text | `#fafafa` |
| Secondary/muted text | `#a1a1aa` |
| Borders / dividers | `#27272a` |
| Recording accent | `#22c55e` |

Color is otherwise reserved entirely for that one recording indicator — the rest of the interface stays strictly monochrome.

### 8.4 Layout principles
- The textarea is edge-to-edge: no visible border, outline, or box-shadow, background matching the panel exactly.
- Header: compact (~40–44px), single 1px bottom border separating it from content.
- The side panel is user-resizable in Chrome — design fluidly within a roughly 320px–600px range rather than assuming a fixed width.
- Buttons are text-only or icon-only by default; `+ New Session` / `+ New Note` can carry a subtle outline or low-contrast fill as the one primary call-to-action in their respective empty/list states.
- No modal dialogs anywhere — settings and history are simple in-panel views reached via a back arrow, and confirmations use the tap-to-arm pattern.

### 8.5 Wireframes

**Global Notes — Editor (default landing view)**
```
┌──────────────────────────────────────┐
│  Global    Sessions           ☰   ⋮   │
├──────────────────────────────────────┤
│  Note 1                               │  ← editable title
│                                        │
│  Jot something down…                  │
│                                        │
└──────────────────────────────────────┘
```

**Global Notes — List view**
```
┌──────────────────────────────────────┐
│  ←  Global Notes                      │
├──────────────────────────────────────┤
│  [ + New Note ]                       │
├──────────────────────────────────────┤
│  Note 1                               │
│    Edited 2 min ago                   │
├──────────────────────────────────────┤
│  Note 2                               │
│    Edited yesterday                   │
└──────────────────────────────────────┘
```

**Sessions — empty state**
```
┌──────────────────────────────────────┐
│  Global    Sessions           ☰   ⋮   │
├──────────────────────────────────────┤
│            No sessions yet            │
│   Start one to track the pages you    │
│     visit while you think something   │
│              through                  │
│                                        │
│          [ + New Session ]            │
└──────────────────────────────────────┘
```

**Sessions — List view**
```
┌──────────────────────────────────────┐
│  ←  Sessions                          │
├──────────────────────────────────────┤
│  [ + New Session ]                    │
├──────────────────────────────────────┤
│  📌 Session 3 — Jul 2, 9:10 AM         │
│     Created Jul 2 · Edited 4 days ago │
│     8 links                           │
├──────────────────────────────────────┤
│  ● Session 5 — Jul 9, 11:02 AM         │
│     Recording · 3 links · just now    │
├──────────────────────────────────────┤
│  Session 1 — Jun 21, 3:45 PM          │
│     Created Jun 21 · Edited Jun 22    │
│     12 links                          │
└──────────────────────────────────────┘
```
*(Note the numbers don't need to appear in top-to-bottom order — pinned status and recency drive sort order, not the session number.)*

**Session Editor — accordion expanded, with favicons**
```
├──────────────────────────────────────┤
│  ▾ Session context · 2 links          │
│                                        │
│  🌐 CSS Grid Layout - MDN Web Docs     │
│     developer.mozilla.org/en-US/...   │
│                                        │
│  🌐 A Complete Guide to Grid           │
│     css-tricks.com/snippets/css/...   │
└──────────────────────────────────────┘
```

**Kebab menu, open**
```
                         ┌────────────────────────┐
                         │  Copy All                 │
                         │  Download as Markdown      │
                         │  Clear Note Text            │
                         │  Delete Session               │
                         │  ─────────────────────────  │
                         │  Settings                     │
                         └────────────────────────┘
```

**Settings**
```
┌──────────────────────────────────────┐
│  ←  Settings                          │
├──────────────────────────────────────┤
│  Theme                  System  ▾     │
│                                        │
│  Deep dive tracking          [ off ]  │
│   Keep recording session links even   │
│   when the panel is closed.           │
│   Automatically off in Incognito.     │
└──────────────────────────────────────┘
```

### 8.6 Motion
Minimal and fast: short (≤150ms) opacity/height transitions for the accordion expand/collapse and view switches. No bouncy/playful easing — motion should feel like it's confirming an action happened, not entertaining the user.

---

## 9. Build Roadmap

Given how much scope grew across this planning process, this is now 14 phases (up from an original 11) — worth re-grouping into Claude Code sessions accordingly (the earlier plan assumed roughly 5 sessions covering 11 phases; 6 sessions is probably the better fit now — happy to help re-derive that grouping if useful).

1. **Scaffolding** — manifest (including the `commands` and `incognito` keys), folder structure, confirm the side panel opens on icon click and via the keyboard shortcut.
2. **Global Notes data layer** — multiple notes, numbered titles, auto-created first note, debounced autosave, full round-trip persistence.
3. **Global Notes List + Editor views** — the ☰ list icon, `+ New Note`, switching between notes.
4. **Navigation shell** — top-level Global/Sessions tabs, kebab menu shell (stub actions), view routing.
5. **Sessions data layer** — create/list/open sessions, numbered + timestamped titles, empty state.
6. **Sessions List + Editor views** — History List (with pin icons, created/edited times), editable title, recording indicator UI (visual only for now).
7. **Background tracking engine** — active-tab/focused-window detection, URL cleaning, dedup, appending to whichever session is currently active (reactivation-aware).
8. **Panel-open detection** — port wiring for default Panel-Driven tracking.
9. **Deep Dive mode** — settings toggle, persisted pause/resume, static toolbar badge.
10. **Incognito support** — `spanning` mode, the runtime Deep-Dive-disable check, and the early manual verification that the panel renders correctly in an actual Incognito window.
11. **Kebab menu full wire-up** — Copy All, Download as Markdown (shared formatter), Clear Note Text, Delete (tap-to-confirm), Settings view.
12. **Favicons** — `_favicon/` URL construction in the references accordion.
13. **Pinning** — toggle + sort-to-top in the Sessions List view.
14. **Polish + edge-case testing** — empty states, transitions, accessibility, resized-panel testing, `chrome://` filtering, refresh/back-button dedup, multi-window behavior, service worker suspend/resume, Incognito data-sharing confirmation, large-note performance.

---

## 10. Testing Notes
Load via `chrome://extensions` → "Load unpacked." Beyond the original checks (panel open/close cycling in default mode, service worker suspend/resume mid-Deep-Dive, multi-window behavior), explicitly test: enabling "Allow in Incognito" and confirming the panel renders correctly there; confirming a note/session created in Incognito shows up in a normal window and vice versa; confirming Deep Dive genuinely can't be triggered while in an Incognito window even if it's on in the stored setting; and the keyboard shortcut correctly toggling the panel without conflicting with an existing browser/OS shortcut.

---

## 11. Assumptions & Decisions Made — Please Confirm

Most open questions from the original draft got resolved explicitly in conversation. What's left are the genuinely new judgment calls from this round:

1. **Global Notes titles skip the timestamp suffix** (`Note 3`, not `Note 3 — Jul 2, 4:10 PM`) while Sessions keep it. Reasoning: Global Notes are lighter-weight scratch content where the timing detail matters less than in a research session — but this is a style choice, trivially reversible if you'd rather have both note types match exactly.
2. **`"incognito": "spanning"` over `"split"`.** Confident this is the better architectural fit (no content scripts, nothing injected into pages — Tangent only needs its own side panel and tab metadata), but the exact behavior of a side panel specifically under spanning mode inside an Incognito window isn't something Chrome's documentation addresses directly, so it's flagged in the roadmap (Phase 10) as the first thing to verify manually rather than something guaranteed with total certainty.
3. **No stored data for favicons** — constructed at render time from each link's existing URL via Chrome's `_favicon/` endpoint, rather than persisting anything extra per link. Cheaper and avoids stale/broken images from a page-supplied `favIconUrl` that might not resolve later.
4. **Pinning is Sessions-only for v1**, not extended to Global Notes — matches what was actually asked for; trivial parity feature to add later if wanted.
5. **The keyboard shortcut only toggles the panel open/closed** (via `_execute_action`), reusing existing toggle behavior rather than writing new logic — deliberately the simplest possible v1 implementation of "one shortcut."

If any of these don't match what you had in mind, they're all easy to redirect before or during the build.

---

## 12. Future Enhancements (explicitly not v1)

Parking lot only — do not build these now:
- Full-text search across Global Notes + all Sessions (strongest fast-follow candidate — much more valuable once there's an actual backlog of notes to search through)
- Note-to-link attribution — highlighting which part of a note was written while on which site, colored and numbered to match the corresponding link. Genuinely feasible (a synced read-only overlay behind the textarea can render highlights without abandoning the plain-textarea input itself), but accurate attribution requires timestamping individual text *insertions* and correctly re-mapping their ranges as the user edits earlier text — real, fiddly bookkeeping for a "nice to have." A much lighter partial version worth considering first: store the cursor position at the moment each link is logged, and let clicking a link scroll/flash that spot in the note — far cheaper, though it will drift if the user edits text before that point.
- Additional keyboard shortcuts (e.g., a dedicated "start new session" shortcut) once real usage shows what's actually wanted
- Per-session override of Deep Dive mode (instead of one global setting)
- Per-link visit count / last-visited timestamp
- Pinning for Global Notes (parity with Sessions)
- Re-activating tracking into an old session automatically resuming exactly where multi-window focus last left off (current design already covers the common case; this would only matter for unusual multi-window edge cases)