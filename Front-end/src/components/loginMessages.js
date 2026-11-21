/**
 * loginMessages.js — every message the LoginScreen shows, in one place (Req 10.3).
 * Plain, warm wording; never status codes or internal errors.
 */

export const MESSAGES = Object.freeze({
  credentialsMismatch: "That username and password don't match.",
  answersMismatch: "One of those didn't quite match. Let's try again.",
  busy: 'The museum is a little busy. Please try again in a moment.',
  badRequest: 'Something went wrong. Please try again.',
  unavailable: 'The museum is having trouble opening its doors. Please try again soon.',
  network: "Couldn't reach the museum. Check your connection and try again.",
  missingUsername: 'Please enter your username.',
  missingPassword: 'Please enter your password.',
  missingBoth: 'Please enter your username and password.',
  missingAnswer: 'Please enter an answer.',
});

/** @param {number} seconds */
export function tooManyTriesMessage(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many tries for now. Take a breather and try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/**
 * Map a failed authClient result to a message and an optional lockout end time (ms).
 *
 * @param {{reason:string, retryAfterSeconds?:number}} result
 * @param {'credentials'|'questions'} step
 * @param {number} [nowMs]
 * @returns {{message:string, lockedUntil:number|null}}
 */
export function describeFailure(result, step, nowMs = Date.now()) {
  switch (result.reason) {
    case 'mismatch':
      return { message: step === 'credentials' ? MESSAGES.credentialsMismatch : MESSAGES.answersMismatch, lockedUntil: null };
    case 'rate-limited':
      // A 429 without Retry-After is Lambda's own "busy" throttle, not a lockout.
      if (typeof result.retryAfterSeconds !== 'number') return { message: MESSAGES.busy, lockedUntil: null };
      return { message: tooManyTriesMessage(result.retryAfterSeconds), lockedUntil: nowMs + result.retryAfterSeconds * 1000 };
    case 'bad-request':
      return { message: MESSAGES.badRequest, lockedUntil: null };
    case 'network':
      return { message: MESSAGES.network, lockedUntil: null };
    default:
      return { message: MESSAGES.unavailable, lockedUntil: null };
  }
}
