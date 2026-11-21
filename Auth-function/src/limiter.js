/**
 * limiter.js — the Attempt_Limiter: 5 failed sign-ins per 15 minutes, per viewer IP.
 *
 * Counters live in this Lambda instance's memory. The function runs with reserved
 * concurrency 1, so every request reaches the same counters. They reset if AWS replaces
 * the instance after it sits idle; that is an accepted trade-off (Req 8.6). There is no
 * limit shared across IPs, so nobody else's failures can lock her out (Req 8.3).
 *
 * IPs are stored only as SHA-256 hashes. `now` is always passed in (epoch seconds), so
 * the windowing is deterministic and testable. Requirements: 8.1–8.5.
 */

import { createHash } from 'node:crypto';

export const MAX_FAILURES = 5;
export const WINDOW_SECONDS = 15 * 60;

/** @param {string} ip */
function hashIp(ip) {
  return createHash('sha256').update(String(ip)).digest('hex');
}

/**
 * Create an independent limiter (tests make their own; Lambda uses `limiter` below).
 *
 * @param {{maxFailures?:number, windowSeconds?:number}} [options]
 */
export function createLimiter({ maxFailures = MAX_FAILURES, windowSeconds = WINDOW_SECONDS } = {}) {
  /** @type {Map<string, {failures:number, windowStart:number}>} */
  const entries = new Map();

  const windowEnd = (entry) => entry.windowStart + windowSeconds;

  /** Drop every entry whose window has ended, so the map stays tiny. */
  function sweep(now) {
    for (const [key, entry] of entries) {
      if (now >= windowEnd(entry)) entries.delete(key);
    }
  }

  return {
    /**
     * @param {string} ip
     * @param {number} now - epoch seconds
     * @returns {{locked:boolean, retryAfterSeconds:number}}
     */
    isLocked(ip, now) {
      sweep(now);
      const entry = entries.get(hashIp(ip));
      if (!entry || entry.failures < maxFailures) return { locked: false, retryAfterSeconds: 0 };
      return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil(windowEnd(entry) - now)) };
    },

    /**
     * Count one failed attempt. The first failure in a window starts the window.
     * @param {string} ip
     * @param {number} now - epoch seconds
     */
    recordFailure(ip, now) {
      sweep(now);
      const key = hashIp(ip);
      const entry = entries.get(key);
      if (entry) entry.failures += 1;
      else entries.set(key, { failures: 1, windowStart: now });
    },

    /** Forget an IP's failures (after a successful sign-in). @param {string} ip */
    clear(ip) {
      entries.delete(hashIp(ip));
    },

    /** Number of tracked IPs (tests/debug). */
    get size() {
      return entries.size;
    },
  };
}

/** The instance the Lambda handler uses; lives as long as the warm instance. */
export const limiter = createLimiter();
