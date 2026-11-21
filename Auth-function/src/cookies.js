/**
 * cookies.js — the three CloudFront signed cookies that unlock /Memories/*.
 *
 * Signs a custom policy for `https://<APP_DOMAIN>/Memories/*` that expires 12 hours after
 * issue, then formats each cookie as a host-only session cookie (no Domain, no
 * Expires/Max-Age), so closing the browser signs her out. Requirements: 5.1, 5.2, 5.3.
 *
 * Signing uses CloudFront's default RSA-SHA1, which yields exactly the three cookies the
 * distribution expects. (The signer also supports SHA-256, which adds a fourth
 * `CloudFront-Hash-Algorithm` cookie; not used here.)
 */

import { getSignedCookies } from '@aws-sdk/cloudfront-signer';

/** How long a signed policy stays valid: 12 hours (the Access_Window). */
export const ACCESS_WINDOW_SECONDS = 12 * 60 * 60;

/** Attributes on every access cookie. */
export const COOKIE_ATTRIBUTES = 'Path=/Memories; Secure; HttpOnly; SameSite=Strict';

/** The cookie names CloudFront needs, in the order they are sent. */
export const COOKIE_NAMES = Object.freeze(['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id']);

/**
 * Build the custom policy JSON.
 *
 * @param {string} appDomain - host only, e.g. `d123abc.cloudfront.net`
 * @param {number} nowSeconds - issue time, epoch seconds
 * @returns {string}
 */
export function buildPolicy(appDomain, nowSeconds) {
  return JSON.stringify({
    Statement: [
      {
        Resource: `https://${appDomain}/Memories/*`,
        Condition: { DateLessThan: { 'AWS:EpochTime': Math.floor(nowSeconds) + ACCESS_WINDOW_SECONDS } },
      },
    ],
  });
}

/**
 * Sign and format the three access cookies.
 *
 * @param {object} args
 * @param {string} args.appDomain
 * @param {string} args.keyPairId
 * @param {string} args.privateKey - PEM
 * @param {number} args.nowSeconds - issue time, epoch seconds
 * @param {typeof getSignedCookies} [args.signCookies] - injectable for tests
 * @returns {string[]} three `name=value; attributes` strings, for a function URL's `cookies` array
 */
export function buildAccessCookies({ appDomain, keyPairId, privateKey, nowSeconds, signCookies = getSignedCookies }) {
  const policy = buildPolicy(appDomain, nowSeconds);
  const signed = signCookies({ policy, keyPairId, privateKey });
  return COOKIE_NAMES.map((name) => {
    const value = signed?.[name];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`signer did not return ${name}`);
    }
    return `${name}=${value}; ${COOKIE_ATTRIBUTES}`;
  });
}
