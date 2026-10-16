import type { User } from '../types';

const STORAGE_KEY_ID = 'watchparty_user_id';
const STORAGE_KEY_NAME = 'watchparty_user_name';
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

/**
 * Returns a stable unique user profile for this browser session.
 * Opening a second browser session (or Incognito window) gets an independent identity!
 */
export function getOrCreateSessionUser(): User {
  let id = localStorage.getItem(STORAGE_KEY_ID);
  let name = localStorage.getItem(STORAGE_KEY_NAME);
  let avatar = localStorage.getItem(STORAGE_KEY_AVATAR);
  let color = localStorage.getItem(STORAGE_KEY_COLOR);

  if (!id) {
    id = `usr_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
    localStorage.setItem(STORAGE_KEY_ID, id);
  }

  if (!name) {
    const randomNum = Math.floor(10 + Math.random() * 90);
    name = `Film Club Guest #${randomNum}`;
    localStorage.setItem(STORAGE_KEY_NAME, name);
  }

  if (!avatar) {
    const pickedAvatar = SAMPLE_AVATARS[Math.floor(Math.random() * SAMPLE_AVATARS.length)];
    avatar = pickedAvatar;
    localStorage.setItem(STORAGE_KEY_AVATAR, avatar);
  }

  if (!color) {
    const pickedColor = SAMPLE_COLORS[Math.floor(Math.random() * SAMPLE_COLORS.length)];
    color = pickedColor;
    localStorage.setItem(STORAGE_KEY_COLOR, color);
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

export function saveSessionUser(user: Partial<User>): void {
  if (user.name) localStorage.setItem(STORAGE_KEY_NAME, user.name);
  if (user.avatar) localStorage.setItem(STORAGE_KEY_AVATAR, user.avatar);
  if (user.color) localStorage.setItem(STORAGE_KEY_COLOR, user.color);
}

