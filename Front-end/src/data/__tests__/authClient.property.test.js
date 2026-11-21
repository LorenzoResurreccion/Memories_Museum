// @vitest-environment node
// authClient touches no DOM; plain Node gives a reliable Web Crypto SHA-256.
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { probeSession, startLogin, finishLogin, postJson } from '../authClient.js';

/** A minimal fetch Response stand-in. */
function response(status, { headers = {}, json } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => map.get(name.toLowerCase()) ?? null },
    json: async () => json,
  };
}

const statusArb = fc.integer({ min: 100, max: 599 });

describe('authClient (property tests)', () => {
  // Feature: museum-login, Property 8: Probe and response mapping
  // **Validates: Requirements 7.1–7.4, 8.7**
  it('Property 8a: probeSession is signed-in iff 200/404, signed-out iff 403, else unreachable', async () => {
    await fc.assert(
      fc.asyncProperty(statusArb, async (status) => {
        const expected = status === 200 || status === 404 ? 'signed-in' : status === 403 ? 'signed-out' : 'unreachable';
        expect(await probeSession(async () => response(status))).toBe(expected);
      }),
      { numRuns: 300 },
    );
    expect(await probeSession(async () => { throw new TypeError('offline'); })).toBe('unreachable');
  });

  it('Property 8b: start/finish map 401, 429 (+Retry-After), 400, 503 and other failures', async () => {
    await fc.assert(
      fc.asyncProperty(
        statusArb,
        fc.option(fc.integer({ min: 0, max: 3600 }), { nil: undefined }),
        async (status, retryAfter) => {
          const headers = retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) };
          const fetchImpl = async () => response(status, { headers, json: { questions: ['a', 'b', 'c'] } });
          const start = await startLogin('u', 'p', fetchImpl);
          const finish = await finishLogin('u', 'p', ['a', 'b', 'c'], fetchImpl);

          const expectFailure = (result, okStatuses) => {
            if (okStatuses.includes(status)) return expect(result.ok).toBe(true);
            const reason =
              status === 401 ? 'mismatch'
                : status === 429 ? 'rate-limited'
                  : status === 400 ? 'bad-request'
                    : 'unavailable';
            const expected = { ok: false, reason };
            if (status === 429 && retryAfter !== undefined) expected.retryAfterSeconds = retryAfter;
            expect(result).toEqual(expected);
          };
          expectFailure(start, [200]);
          expectFailure(finish, [200, 204]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('Property 8c: a network error is always "network"', async () => {
    const offline = async () => { throw new TypeError('Failed to fetch'); };
    expect(await startLogin('u', 'p', offline)).toEqual({ ok: false, reason: 'network' });
    expect(await finishLogin('u', 'p', ['a', 'b', 'c'], offline)).toEqual({ ok: false, reason: 'network' });
  });

  // Feature: museum-login, Property 9: The body hash header matches the body
  // **Validates: design constraint (OAC for Lambda function URLs)**
  it('Property 9: x-amz-content-sha256 is the hex SHA-256 of the exact body bytes sent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          username: fc.string({ unit: 'binary', maxLength: 30 }),
          password: fc.string({ unit: 'binary', maxLength: 30 }),
          answers: fc.array(fc.string({ unit: 'binary', maxLength: 30 }), { minLength: 3, maxLength: 3 }),
        }),
        async (payload) => {
          const fetchImpl = vi.fn(async () => response(204));
          await postJson('/api/login/finish', payload, fetchImpl);
          const [, init] = fetchImpl.mock.calls[0];
          const sentBytes = Buffer.from(init.body);
          expect(init.headers['x-amz-content-sha256']).toBe(createHash('sha256').update(sentBytes).digest('hex'));
          expect(init.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
          expect(JSON.parse(sentBytes.toString('utf8'))).toEqual(payload);
        },
      ),
      { numRuns: 200 },
    );
  });
});
