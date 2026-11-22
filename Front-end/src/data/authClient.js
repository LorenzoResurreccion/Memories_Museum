/**
 * authClient.js — the browser side of the museum login.
 *
 * - `probeSession()` asks whether the browser already holds valid access cookies, by
 *   sending HEAD for the first letter: 200/404 = signed in, 403 = signed out.
 * - `startLogin()` / `finishLogin()` call the login function. The answers are checked
 *   only all together in `finishLogin()`.
 *
 * Every POST carries `x-amz-content-sha256` (hex SHA-256 of the exact body bytes),
 * which Lambda requires for POSTs that reach it through CloudFront with OAC.
 *
 * The password and answers are never stored or logged here. Matching (case, spacing,
 * punctuation) happens only on the server. Requirements: 7.1–7.4, 8.7.
 */

import { dialogueUrl } from './mediaBase.js';

/** True in production builds and Demo_Mode (`VITE_AUTH_ENABLED=true`); false in `npm run dev`. */
// Plain `import.meta.env.VITE_*` form, which Vite replaces statically at build time.
export const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';

const API_BASE = '/api/login';

/**
 * @typedef {'mismatch'|'rate-limited'|'bad-request'|'unavailable'|'network'} FailureReason
 * @typedef {{ok:false, reason:FailureReason, retryAfterSeconds?:number}} Failure
 */

/**
 * Hex SHA-256 of `bytes` using Web Crypto.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse a `Retry-After` header (delta seconds or an HTTP date) into whole seconds.
 * @param {string|null} value
 * @param {number} [nowMs]
 * @returns {number|undefined}
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  // Only the standard HTTP-date form (IMF-fixdate, e.g. "Sun, 06 Nov 1994 08:49:37 GMT").
  // Date.parse alone is too lenient: it reads junk like "-5" as a year.
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) return undefined;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

/**
 * Map a non-success response to a Failure.
 * @param {{status:number, headers?:{get(name:string):string|null}}} res
 * @returns {Failure}
 */
export function failureFor(res) {
  switch (res.status) {
    case 401:
      return { ok: false, reason: 'mismatch' };
    case 429: {
      const retryAfterSeconds = parseRetryAfter(res.headers?.get?.('retry-after') ?? null);
      return retryAfterSeconds === undefined
        ? { ok: false, reason: 'rate-limited' }
        : { ok: false, reason: 'rate-limited', retryAfterSeconds };
    }
    case 400:
      return { ok: false, reason: 'bad-request' };
    default:
      return { ok: false, reason: 'unavailable' };
  }
}

/**
 * POST JSON with the body hash header Lambda behind CloudFront requires.
 * The same encoded bytes are hashed and sent, so the hash always matches the body.
 *
 * @param {string} path
 * @param {object} payload
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<Response>}
 */
export async function postJson(path, payload, fetchImpl) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  return fetchImpl(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-amz-content-sha256': await sha256Hex(body),
    },
    body,
    credentials: 'same-origin',
    cache: 'no-store',
  });
}

/**
 * Does the browser already hold valid access cookies?
 *
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<'signed-in'|'signed-out'|'unreachable'>}
 */
export async function probeSession(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(dialogueUrl(0), {
      method: 'HEAD',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (res.status === 200 || res.status === 404) return 'signed-in';
    if (res.status === 403) return 'signed-out';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/**
 * Step 1: check the username and password; on success get the three question prompts.
 *
 * @param {string} username
 * @param {string} password
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ok:true, questions:string[]} | Failure>}
 */
export async function startLogin(username, password, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await postJson(`${API_BASE}/start`, { username, password }, fetchImpl);
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (res.status !== 200) return failureFor(res);
  try {
    const data = await res.json();
    const questions = data?.questions;
    if (Array.isArray(questions) && questions.length === 3 && questions.every((q) => typeof q === 'string')) {
      return { ok: true, questions };
    }
  } catch {
    // fall through: malformed body
  }
  return { ok: false, reason: 'unavailable' };
}

/**
 * Step 2: send the credentials and all three answers together. On success the server
 * has set the access cookies.
 *
 * @param {string} username
 * @param {string} password
 * @param {string[]} answers - exactly three
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ok:true} | Failure>}
 */
export async function finishLogin(username, password, answers, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await postJson(`${API_BASE}/finish`, { username, password, answers }, fetchImpl);
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (res.status === 204 || res.status === 200) return { ok: true };
  return failureFor(res);
}
