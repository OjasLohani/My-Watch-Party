import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPLAY_NAME_MAX,
  displayNameLength,
  normalizeDisplayName,
  validateDisplayName,
} from '../src/lib/displayName.ts';

test('trims and collapses whitespace', () => {
  assert.equal(normalizeDisplayName('   Ann   \t Lee  \n'), 'Ann Lee');
});

test('rejects empty and whitespace-only names', () => {
  for (const raw of ['', '   ', '\n\t', '​​', '‮']) {
    const result = validateDisplayName(raw);
    assert.equal(result.ok, false, JSON.stringify(raw));
  }
  assert.deepEqual(validateDisplayName('   '), { ok: false, error: 'Please enter a name.' });
});

test('removes invisible, control and text-direction characters', () => {
  assert.equal(normalizeDisplayName('Ann\u0000\u0007 Lee'), 'Ann Lee');
  assert.equal(normalizeDisplayName('Ann​‌ Lee﻿'), 'Ann Lee', 'zero-width characters');
  assert.equal(normalizeDisplayName('‮evil‬'), 'evil', 'right-to-left override (spoofing)');
});

test('keeps emoji, including joined emoji', () => {
  assert.equal(normalizeDisplayName('Dev 👩‍💻'), 'Dev 👩‍💻');
  assert.equal(normalizeDisplayName('🍿 Fan'), '🍿 Fan');
});

test(`limits names to ${DISPLAY_NAME_MAX} characters (counted like the database)`, () => {
  const exact = 'a'.repeat(DISPLAY_NAME_MAX);
  assert.deepEqual(validateDisplayName(exact), { ok: true, name: exact });
  assert.equal(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX + 1)).ok, false);
  // 40 emoji are 80 UTF-16 units but 40 characters: allowed
  const emoji = '🎬'.repeat(DISPLAY_NAME_MAX);
  assert.equal(displayNameLength(emoji), DISPLAY_NAME_MAX);
  assert.equal(validateDisplayName(emoji).ok, true);
  // The limit applies after trimming
  assert.equal(validateDisplayName(`  ${exact}  `).ok, true);
});

test('HTML-like names are kept as plain text (React renders them literally)', () => {
  const raw = '<img src=x onerror=alert(1)>';
  assert.deepEqual(validateDisplayName(raw), { ok: true, name: raw });
});
