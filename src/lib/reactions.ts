/** Emoji reactions offered in the room (and the only ones accepted from others). */
export const REACTION_EMOJIS = ['🔥', '❤️', '🍿', '🚀', '😱', '👏'] as const;

export function isAllowedReaction(emoji: unknown): emoji is string {
  return typeof emoji === 'string' && (REACTION_EMOJIS as readonly string[]).includes(emoji);
}
