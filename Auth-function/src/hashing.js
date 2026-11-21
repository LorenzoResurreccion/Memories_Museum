/**
 * hashing.js — salted scrypt hashes for the username, password and answers.
 *
 * Stored format: `scrypt$N$r$p$<salt base64>$<key base64>`. Each hash has its own random
 * 16-byte salt, so two hashes of the same input differ but both verify. Verification
 * recomputes the key with the stored parameters and compares with `timingSafeEqual`.
 * Requirement 4.4.
 *
 * The real cost (N = 2^15) takes roughly 50–100 ms per hash on a 512 MB Lambda, which
 * deliberately slows guessing. Tests pass a lower `N` through `options`.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/** Default scrypt cost parameters used for every stored hash. */
export const SCRYPT_DEFAULTS = Object.freeze({ N: 2 ** 15, r: 8, p: 1, keyLength: 32, saltLength: 16 });

/** Comfortably above the 32 MiB that N = 2^15, r = 8 needs (128 * N * r bytes). */
const MAX_MEM_BYTES = 64 * 1024 * 1024;

/** Hard ceilings on parameters read from a stored hash, so a bad config can't exhaust memory. */
const LIMITS = Object.freeze({ maxN: 2 ** 20, maxR: 32, maxP: 16, maxKeyLength: 64, minKeyLength: 16 });

const PREFIX = 'scrypt';

/**
 * @param {string|Buffer} input
 * @param {Buffer} salt
 * @param {number} keyLength
 * @param {{N:number, r:number, p:number}} cost
 * @returns {Promise<Buffer>}
 */
function deriveKey(input, salt, keyLength, { N, r, p }) {
  return new Promise((resolve, reject) => {
    scryptCallback(input, salt, keyLength, { N, r, p, maxmem: MAX_MEM_BYTES }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Hash `input` with a fresh random salt.
 *
 * @param {string} input
 * @param {{N?:number, r?:number, p?:number, keyLength?:number, saltLength?:number}} [options]
 * @returns {Promise<string>} `scrypt$N$r$p$salt$key`
 */
export async function hash(input, options = {}) {
  if (typeof input !== 'string') throw new TypeError('hash input must be a string');
  const { N, r, p, keyLength, saltLength } = { ...SCRYPT_DEFAULTS, ...options };
  const salt = randomBytes(saltLength);
  const key = await deriveKey(input, salt, keyLength, { N, r, p });
  return [PREFIX, N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Parse a stored hash. Returns null for anything malformed or outside the limits.
 *
 * @param {string} stored
 * @returns {{N:number, r:number, p:number, salt:Buffer, key:Buffer} | null}
 */
export function parseHash(stored) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [N, r, p] = parts.slice(1, 4).map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
  const isPowerOfTwo = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0;
  if (!isPowerOfTwo || N > LIMITS.maxN) return null;
  if (!Number.isInteger(r) || r < 1 || r > LIMITS.maxR) return null;
  if (!Number.isInteger(p) || p < 1 || p > LIMITS.maxP) return null;
  const salt = Buffer.from(parts[4], 'base64');
  const key = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || key.length < LIMITS.minKeyLength || key.length > LIMITS.maxKeyLength) return null;
  return { N, r, p, salt, key };
}

/**
 * True when `input` hashes to `stored`. Never throws; a malformed stored hash is false.
 *
 * @param {string} input
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verify(input, stored) {
  if (typeof input !== 'string') return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;
  try {
    const key = await deriveKey(input, parsed.salt, parsed.key.length, parsed);
    return timingSafeEqual(key, parsed.key);
  } catch {
    return false;
  }
}
