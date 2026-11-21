/**
 * checks.js — compare a sign-in attempt against the hashed Auth_Config (no I/O).
 *
 * Every comparison always runs, even after one has failed, so the response time never
 * hints at how many checks passed (Req 4.6). The comparisons run concurrently; scrypt
 * runs on Node's thread pool, so this is also faster than one after another.
 *
 * The setup tool must hash `normalizeUsername(username)` and `normalizeAnswer(answer)`,
 * matching what is compared here. The password is hashed and compared as typed.
 * Requirements: 4.1, 4.3, 4.5, 4.6.
 *
 * `verifyFn` is injectable so tests can count comparisons (Property 4) and run fast.
 */

import { verify } from './hashing.js';
import { normalizeAnswer, normalizeUsername } from './normalize.js';

/**
 * @typedef {object} AuthConfig
 * @property {number} version
 * @property {string} usernameHash
 * @property {string} passwordHash
 * @property {{prompt:string, answerHash:string}[]} questions - exactly 3
 */

/**
 * @typedef {(input:string, stored:string) => Promise<boolean>} VerifyFn
 */

/**
 * Check the username and password (the `start` step). Runs both comparisons.
 *
 * @param {AuthConfig} config
 * @param {string} username
 * @param {string} password
 * @param {{verifyFn?: VerifyFn}} [options]
 * @returns {Promise<boolean>}
 */
export async function checkCredentials(config, username, password, { verifyFn = verify } = {}) {
  const results = await Promise.all([
    verifyFn(normalizeUsername(username), config.usernameHash),
    verifyFn(typeof password === 'string' ? password : '', config.passwordHash),
  ]);
  return results.every(Boolean);
}

/**
 * Check all three answers. Runs every comparison. Answer `i` is checked only against
 * question `i`; a missing answer counts as an empty string (and still runs).
 *
 * @param {AuthConfig} config
 * @param {string[]} answers
 * @param {{verifyFn?: VerifyFn}} [options]
 * @returns {Promise<boolean>}
 */
export async function checkAnswers(config, answers, { verifyFn = verify } = {}) {
  const list = Array.isArray(answers) ? answers : [];
  const results = await Promise.all(
    config.questions.map((question, i) => verifyFn(normalizeAnswer(list[i] ?? ''), question.answerHash)),
  );
  return results.every(Boolean);
}

/**
 * Check everything for the `finish` step: username, password and all three answers.
 * Exactly 5 comparisons, always (Property 4).
 *
 * @param {AuthConfig} config
 * @param {{username:string, password:string, answers:string[]}} attempt
 * @param {{verifyFn?: VerifyFn}} [options]
 * @returns {Promise<boolean>}
 */
export async function checkAll(config, { username, password, answers }, options = {}) {
  const [credentialsOk, answersOk] = await Promise.all([
    checkCredentials(config, username, password, options),
    checkAnswers(config, answers, options),
  ]);
  return credentialsOk && answersOk;
}
