// Display-name rules, shared by every place a name is entered.
//
// Names are always rendered as plain text by React (never as HTML), so a
// name like "<b>Ann</b>" is shown literally and cannot run code. On top
// of that, invisible and control characters are removed so a name cannot
// hide itself, break the layout, or reverse surrounding text.
//
// The database independently enforces 1–40 characters after trimming
// (room_members_name_length) and lets each user edit only their own row.

/** Maximum length in characters (matches the database rule) */
export const DISPLAY_NAME_MAX = 40;

// Control characters (C0/C1) and format characters such as bidirectional
// overrides (U+202E) and zero-width spaces, except the zero-width joiner
// (U+200D) that combined emoji like 👩‍💻 need.
const INVISIBLE = /(?!‍)[\p{Cc}\p{Cf}]/gu;

/** Cleans a typed name: removes invisible characters, collapses spaces, trims */
export function normalizeDisplayName(raw: string): string {
  return raw.replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
}

/** Length as the database counts it (characters, not UTF-16 units) */
export function displayNameLength(name: string): number {
  return [...name].length;
}

export type DisplayNameResult = { ok: true; name: string } | { ok: false; error: string };

export function validateDisplayName(raw: string): DisplayNameResult {
  const name = normalizeDisplayName(raw);
  if (!name) return { ok: false, error: 'Please enter a name.' };
  if (displayNameLength(name) > DISPLAY_NAME_MAX) {
    return { ok: false, error: `Names can be at most ${DISPLAY_NAME_MAX} characters.` };
  }
  return { ok: true, name };
}
