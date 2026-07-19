const GLOBAL_NOTE_KEYS = [
  'globalNotes',
  'nextGlobalNoteNumber',
  'lastOpenGlobalNoteId',
];

const SESSION_KEYS = [
  'sessions',
  'nextSessionNumber',
  'activeSessionId',
];

const DEFAULT_GLOBAL_NOTE_NUMBER = 1;
const DEFAULT_SESSION_NUMBER = 1;

export const storage = {
  async get(keys) {
    return chrome.storage.local.get(keys);
  },

  async set(values) {
    return chrome.storage.local.set(values);
  },
};

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function defaultTitle(number) {
  return `Note ${number}`;
}

function sortByUpdatedAt(notes) {
  return Object.values(notes).sort((a, b) => b.updatedAt - a.updatedAt);
}

function sessionTitle(number, timestamp) {
  const date = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
  return `Session ${number} \u2014 ${date}`;
}

async function readGlobalNotes() {
  const data = await storage.get(GLOBAL_NOTE_KEYS);
  return {
    globalNotes: data.globalNotes ?? {},
    nextGlobalNoteNumber: data.nextGlobalNoteNumber ?? DEFAULT_GLOBAL_NOTE_NUMBER,
    lastOpenGlobalNoteId: data.lastOpenGlobalNoteId ?? null,
  };
}

export async function getGlobalNotes() {
  const { globalNotes } = await readGlobalNotes();
  return sortByUpdatedAt(globalNotes);
}

export async function ensureInitialGlobalNote() {
  const data = await readGlobalNotes();
  const notes = sortByUpdatedAt(data.globalNotes);

  if (notes.length > 0) {
    const lastOpenId = data.globalNotes[data.lastOpenGlobalNoteId]
      ? data.lastOpenGlobalNoteId
      : notes[0].id;

    if (lastOpenId !== data.lastOpenGlobalNoteId) {
      await storage.set({ lastOpenGlobalNoteId: lastOpenId });
    }
    return data.globalNotes[lastOpenId];
  }

  return createGlobalNote();
}

export async function createGlobalNote() {
  const data = await readGlobalNotes();
  const now = Date.now();
  const number = data.nextGlobalNoteNumber;
  const note = {
    id: makeId(),
    number,
    title: defaultTitle(number),
    titleIsCustom: false,
    content: '',
    createdAt: now,
    updatedAt: now,
  };

  await storage.set({
    globalNotes: { ...data.globalNotes, [note.id]: note },
    nextGlobalNoteNumber: number + 1,
    lastOpenGlobalNoteId: note.id,
  });

  return note;
}

export async function openGlobalNote(id) {
  const { globalNotes } = await readGlobalNotes();
  const note = globalNotes[id];
  if (!note) return null;

  await storage.set({ lastOpenGlobalNoteId: id });
  return note;
}

async function updateGlobalNote(id, updates) {
  const data = await readGlobalNotes();
  const existing = data.globalNotes[id];
  if (!existing) return null;

  const note = { ...existing, ...updates, updatedAt: Date.now() };
  await storage.set({
    globalNotes: { ...data.globalNotes, [id]: note },
  });
  return note;
}

export function saveGlobalNoteContent(id, content) {
  return updateGlobalNote(id, { content });
}

export async function renameGlobalNote(id, title) {
  const data = await readGlobalNotes();
  const existing = data.globalNotes[id];
  if (!existing) return null;

  const trimmedTitle = title.trim();
  const note = {
    ...existing,
    title: trimmedTitle || defaultTitle(existing.number),
    titleIsCustom: Boolean(trimmedTitle),
    updatedAt: Date.now(),
  };
  await storage.set({ globalNotes: { ...data.globalNotes, [id]: note } });
  return note;
}

async function readSessions() {
  const data = await storage.get(SESSION_KEYS);
  return {
    sessions: data.sessions ?? {},
    nextSessionNumber: data.nextSessionNumber ?? DEFAULT_SESSION_NUMBER,
    activeSessionId: data.activeSessionId ?? null,
  };
}

export async function getSessions() {
  const { sessions } = await readSessions();
  return sortByUpdatedAt(sessions);
}

export async function getActiveSession() {
  const data = await readSessions();
  const session = data.sessions[data.activeSessionId];
  if (session) return session;

  const fallback = sortByUpdatedAt(data.sessions)[0] ?? null;
  if (fallback) await storage.set({ activeSessionId: fallback.id });
  return fallback;
}

export async function createSession() {
  const data = await readSessions();
  const now = Date.now();
  const number = data.nextSessionNumber;
  const session = {
    id: `session_${makeId()}`,
    number,
    title: sessionTitle(number, now),
    titleIsCustom: false,
    content: '',
    createdAt: now,
    updatedAt: now,
    pinned: false,
    links: [],
  };

  await storage.set({
    sessions: { ...data.sessions, [session.id]: session },
    nextSessionNumber: number + 1,
    activeSessionId: session.id,
  });
  return session;
}

export async function openSession(id) {
  const { sessions } = await readSessions();
  const session = sessions[id];
  if (!session) return null;

  await storage.set({ activeSessionId: id });
  return session;
}

async function updateSession(id, updates) {
  const data = await readSessions();
  const existing = data.sessions[id];
  if (!existing) return null;

  const session = { ...existing, ...updates, updatedAt: Date.now() };
  await storage.set({ sessions: { ...data.sessions, [id]: session } });
  return session;
}

export function saveSessionContent(id, content) {
  return updateSession(id, { content });
}

export async function renameSession(id, title) {
  const data = await readSessions();
  const existing = data.sessions[id];
  if (!existing) return null;

  const trimmedTitle = title.trim();
  const session = {
    ...existing,
    title: trimmedTitle || sessionTitle(existing.number, existing.createdAt),
    titleIsCustom: Boolean(trimmedTitle),
    updatedAt: Date.now(),
  };
  await storage.set({ sessions: { ...data.sessions, [id]: session } });
  return session;
}
