import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import {
  buildAccessCookies,
  buildPolicy,
  ACCESS_WINDOW_SECONDS,
  COOKIE_ATTRIBUTES,
  COOKIE_NAMES,
} from '../src/cookies.js';

/** Cookie-safe values, like CloudFront's URL-safe base64 (`-`, `_`, `~`). */
const cookieValueArb = fc.stringMatching(/^[A-Za-z0-9_~-]{1,80}$/);
const domainArb = fc.stringMatching(/^[a-z0-9]{1,12}\.cloudfront\.net$/);
const nowArb = fc.integer({ min: 1_600_000_000, max: 2_200_000_000 });

/** A fake signer returning the given values and recording what it was asked to sign. */
function fakeSigner(values) {
  return vi.fn(() => ({
    'CloudFront-Policy': values[0],
    'CloudFront-Signature': values[1],
    'CloudFront-Key-Pair-Id': values[2],
  }));
}

describe('cookies (property tests)', () => {
  // Feature: museum-login, Property 5: Cookie headers have exactly the required shape
  // **Validates: Requirements 5.1, 5.2, 5.3**
  it('Property 5: exactly three host-only session cookies with the required attributes and a 12-hour policy', () => {
    fc.assert(
      fc.property(domainArb, nowArb, fc.array(cookieValueArb, { minLength: 3, maxLength: 3 }), (appDomain, now, values) => {
        const signCookies = fakeSigner(values);
        const cookies = buildAccessCookies({ appDomain, keyPairId: 'K1', privateKey: 'pem', nowSeconds: now, signCookies });

        expect(cookies).toHaveLength(3);
        cookies.forEach((cookie, i) => {
          const [nameValue, ...attrs] = cookie.split('; ');
          expect(nameValue).toBe(`${COOKIE_NAMES[i]}=${values[i]}`);
          expect(attrs.join('; ')).toBe(COOKIE_ATTRIBUTES);
          expect(cookie).not.toMatch(/;\s*(Domain|Expires|Max-Age)=/i);
        });
        expect(COOKIE_ATTRIBUTES.split('; ').sort()).toEqual(['HttpOnly', 'Path=/Memories', 'SameSite=Strict', 'Secure']);

        // The signer was given the custom policy with the right resource and expiry.
        expect(signCookies).toHaveBeenCalledTimes(1);
        const { policy, keyPairId, privateKey } = signCookies.mock.calls[0][0];
        expect({ keyPairId, privateKey }).toEqual({ keyPairId: 'K1', privateKey: 'pem' });
        const statement = JSON.parse(policy).Statement;
        expect(statement).toHaveLength(1);
        expect(statement[0].Resource).toBe(`https://${appDomain}/Memories/*`);
        expect(statement[0].Condition).toEqual({ DateLessThan: { 'AWS:EpochTime': now + ACCESS_WINDOW_SECONDS } });
      }),
      { numRuns: 200 },
    );
  });

  it('throws when the signer leaves out a cookie', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 }), (missing) => {
        const values = ['a', 'b', 'c'];
        values[missing] = '';
        expect(() =>
          buildAccessCookies({ appDomain: 'x.cloudfront.net', keyPairId: 'K', privateKey: 'p', nowSeconds: 0, signCookies: fakeSigner(values) }),
        ).toThrow(COOKIE_NAMES[missing]);
      }),
    );
  });

  it('ACCESS_WINDOW_SECONDS is 12 hours and fractional times are floored', () => {
    expect(ACCESS_WINDOW_SECONDS).toBe(43200);
    const policy = JSON.parse(buildPolicy('x.cloudfront.net', 100.9));
    expect(policy.Statement[0].Condition.DateLessThan['AWS:EpochTime']).toBe(100 + 43200);
  });

  it('with the real signer, the signature verifies against the public key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const cookies = buildAccessCookies({ appDomain: 'd1.cloudfront.net', keyPairId: 'K9', privateKey: pem, nowSeconds: 1_800_000_000 });

    const value = (name) => cookies.find((c) => c.startsWith(`${name}=`)).split(';')[0].slice(name.length + 1);
    // CloudFront's URL-safe base64: + -> -, = -> _, / -> ~
    const decode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/'), 'base64');

    const policy = decode(value('CloudFront-Policy')).toString('utf8');
    expect(JSON.parse(policy).Statement[0].Resource).toBe('https://d1.cloudfront.net/Memories/*');
    expect(value('CloudFront-Key-Pair-Id')).toBe('K9');
    const verifier = createVerify('RSA-SHA1');
    verifier.update(policy);
    expect(verifier.verify(publicKey, decode(value('CloudFront-Signature')))).toBe(true);
  });
});
