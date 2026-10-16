import type { User } from '../types';
import { validateDisplayName } from './displayName';

const STORAGE_KEY_ID = 'watchparty_user_id';
const STORAGE_KEY_NAME = 'watchparty_user_name';
const STORAGE_KEY_NAME_CHOSEN = 'watchparty_user_name_chosen';
const STORAGE_KEY_AVATAR = 'watchparty_user_avatar';
const STORAGE_KEY_COLOR = 'watchparty_user_color';

const SAMPLE_AVATARS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=120&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&auto=format&fit=crop&q=80',
];

const SAMPLE_COLORS = ['#8B5CF6', '#06B6D4', '#EC4899', '#10B981', '#F59E0B'];

// localStorage can be unavailable (private windows, blocked site data):
// fall back to values that only live for this page.
const memoryStore = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}

/**
 * Returns a stable unique user profile for this browser session.
 * Opening a second browser session (or Incognito window) gets an independent identity!
 */
export function getOrCreateSessionUser(): User {
  let id = read(STORAGE_KEY_ID);
  let name = read(STORAGE_KEY_NAME);
  let avatar = read(STORAGE_KEY_AVATAR);
  let color = read(STORAGE_KEY_COLOR);

  if (!id) {
    id = `usr_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
    write(STORAGE_KEY_ID, id);
  }

  // Placeholder until the guest picks a name (see hasChosenName)
  if (!name) {
    const randomNum = Math.floor(10 + Math.random() * 90);
    name = `Film Club Guest #${randomNum}`;
    write(STORAGE_KEY_NAME, name);
  }

  if (!avatar) {
    avatar = SAMPLE_AVATARS[Math.floor(Math.random() * SAMPLE_AVATARS.length)];
    write(STORAGE_KEY_AVATAR, avatar);
  }

  if (!color) {
    color = SAMPLE_COLORS[Math.floor(Math.random() * SAMPLE_COLORS.length)];
    write(STORAGE_KEY_COLOR, color);
  }

  return {
    id,
    name,
    avatar,
    color,
    isHost: false,
    isSelf: true,
    isOnline: true,
  };
}

/** True once this browser’s user has picked their own display name */
export function hasChosenName(): boolean {
  return read(STORAGE_KEY_NAME_CHOSEN) === '1' && validateDisplayName(read(STORAGE_KEY_NAME) ?? '').ok;
}

/** The saved name if the user chose one, otherwise an empty string */
export function getChosenName(): string {
  return hasChosenName() ? (read(STORAGE_KEY_NAME) ?? '') : '';
}

/**
 * Remembers the user's chosen display name for future rooms and visits.
 * Returns the cleaned name, or null if it is not valid.
 */
export function saveChosenName(raw: string): string | null {
  const result = validateDisplayName(raw);
  if (!result.ok) return null;
  write(STORAGE_KEY_NAME, result.name);
  write(STORAGE_KEY_NAME_CHOSEN, '1');
  return result.name;
}

export function saveSessionUser(user: Partial<User>): void {
  if (user.name) write(STORAGE_KEY_NAME, user.name);
  if (user.avatar) write(STORAGE_KEY_AVATAR, user.avatar);
  if (user.color) write(STORAGE_KEY_COLOR, user.color);
}
