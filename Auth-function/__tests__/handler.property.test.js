import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { CREDENTIALS, makeAuthConfig, makeEnv, makeHarness, postEvent, rsaKey } from './helpers.js';
import { MAX_BODY_BYTES } from '../src/handler.js';

let env;
let authConfig;
beforeAll(async () => {
  authConfig = await makeAuthConfig();
  env = makeEnv(authConfig);
});

const routeArb = fc.constantFrom('/api/login/start', '/api/login/finish');
const nonString = fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.string(), { maxLength: 2 }), fc.object({ maxDepth: 1 }));

/** Bodies that must be rejected for the given route. */
function invalidBodyArb(route) {
  const variants = [
    // Not JSON at all.
    fc.string({ minLength: 1, maxLength: 40 }).filter((s) => {
      try {
        JSON.parse(s);
        return false;
      } catch {
        return true;
      }
    }),
    // JSON, but not an object.
    fc.oneof(fc.integer(), fc.string(), fc.constant(null), fc.array(fc.string())).map((v) => JSON.stringify(v)),
    // Missing or non-string username / password.
    fc.record({ username: nonString, password: fc.string() }).map((v) => JSON.stringify(v)),
    fc.record({ username: fc.string(), password: nonString }).map((v) => JSON.stringify(v)),
    fc.record({ password: fc.string() }).map((v) => JSON.stringify(v)),
    // Over the size limit.
    fc.integer({ min: MAX_BODY_BYTES + 1, max: MAX_BODY_BYTES * 3 }).map((n) =>
      JSON.stringify({ username: 'u', password: 'p'.repeat(n), answers: ['a', 'b', 'c'] }),
    ),
    // Empty body.
    fc.constant(''),
  ];
  if (route === '/api/login/finish') {
    variants.push(
      // Wrong number of answers, or non-string answers.
      fc
        .array(fc.string({ maxLength: 8 }), { maxLength: 6 })
        .filter((a) => a.length !== 3)
        .map((answers) => JSON.stringify({ username: 'u', password: 'p', answers })),
      fc.tuple(fc.string(), nonString, fc.string()).map((answers) => JSON.stringify({ username: 'u', password: 'p', answers })),
      fc.record({ username: fc.string(), password: fc.string() }).map((v) => JSON.stringify(v)),
    );
  }
  return fc.oneof(...variants);
}

describe('handler (property tests)', () => {
  // Feature: museum-login, Property 7: Invalid bodies never reach the checks
  // **Validates: Requirement 4.8**
  it('Property 7: every invalid body gets 400, with zero comparisons and zero attempts recorded', async () => {
    await fc.assert(
      fc.asyncProperty(
        routeArb.chain((route) => fc.tuple(fc.constant(route), invalidBodyArb(route), fc.boolean())),
        async ([route, body, base64]) => {
          const h = makeHarness(env);
          const res = await h.handler(postEvent(route, body, { base64 }));
          expect(res.statusCode).toBe(400);
          expect(JSON.parse(res.body)).toEqual({ error: 'bad-request' });
          expect(res.headers['cache-control']).toBe('no-store');
          expect(h.verifyFn).not.toHaveBeenCalled();
          expect(h.limiter.recordFailure).not.toHaveBeenCalled();
          expect(h.limiter.size).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  // Feature: museum-login, Property 10: No secret appears in any response
  // **Validates: Requirements 4.7, 5.6**
  it('Property 10: no response or log line contains a submitted secret, a stored hash, or the private key', async () => {
    const pemBody = rsaKey().pem.split('\n').filter((l) => l && !l.startsWith('-----'));
    const hashParts = [authConfig.usernameHash, authConfig.passwordHash, ...authConfig.questions.map((q) => q.answerHash)]
      .flatMap((h) => [h, ...h.split('$').slice(4)]);
    // Distinctive submitted values, so a match in the output can only be a leak.
    const secretArb = fc.stringMatching(/^[a-z0-9]{6,14}$/).map((s) => `zq${s}`);
    const valueArb = fc.oneof(secretArb, fc.constantFrom(CREDENTIALS.username, CREDENTIALS.password, ...CREDENTIALS.answers));

    await fc.assert(
      fc.asyncProperty(
        routeArb,
        valueArb,
        valueArb,
        fc.array(valueArb, { minLength: 3, maxLength: 3 }),
        fc.integer({ min: 1, max: 7 }),
        async (route, username, password, answers, repeats) => {
          const h = makeHarness(env);
          const outputs = [];
          for (let i = 0; i < repeats; i += 1) {
            const res = await h.handler(postEvent(route, { username, password, answers }));
            outputs.push(JSON.stringify(res));
          }
          const everything = outputs.join('\n') + h.logs.join('\n');

          for (const submitted of [username, password, ...answers]) {
            if (submitted.startsWith('zq')) expect(everything).not.toContain(submitted);
          }
          // The real password and answers never echo back either.
          expect(everything).not.toContain(CREDENTIALS.password);
          for (const a of CREDENTIALS.answers) expect(everything).not.toContain(`"${a}"`);
          for (const part of hashParts) expect(everything).not.toContain(part);
          for (const line of pemBody) expect(everything).not.toContain(line);
          expect(everything).not.toContain(env.CLOUDFRONT_PRIVATE_KEY_B64.slice(0, 40));
          // Logs hold only route, outcome and timing.
          for (const line of h.logs) {
            expect(Object.keys(JSON.parse(line)).sort()).toEqual(['ms', 'outcome', 'route']);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
