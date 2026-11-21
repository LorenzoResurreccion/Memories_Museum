/**
 * normalize.js — how submitted usernames and answers are compared (pure, no I/O).
 *
 * Answers are forgiving: case, punctuation and spacing never matter, so "Short Stack!",
 * "short stack" and "  SHORT   stack " all match. Passwords are NOT normalized
 * (compared exactly). Requirements: 4.1, 4.2, 4.3.
 */

/**
 * Normalize an answer for matching: Unicode NFKC, lowercase, drop every character that
 * is not a letter, digit or whitespace, collapse whitespace runs to one space, trim.
 *
 * @param {string} answer
 * @returns {string}
 */
export function normalizeAnswer(answer) {
  if (typeof answer !== 'string') return '';
  return answer
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Normalize a username for matching: trim surrounding whitespace and lowercase.
 *
 * @param {string} username
 * @returns {string}
 */
export function normalizeUsername(username) {
  if (typeof username !== 'string') return '';
  return username.trim().toLowerCase();
}
