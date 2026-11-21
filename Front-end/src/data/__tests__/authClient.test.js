// @vitest-environment node
// authClient touches no DOM; plain Node gives a reliable Web Crypto SHA-256.
import { describe, it, expect, vi } from 'vitest';
import {
  AUTH_ENABLED,
  probeSession,
  startLogin,
  finishLogin,
  parseRetryAfter,
  sha256Hex,
} from '../authClient.js';
import { dialogueUrl } from '../mediaBase.js';

function response(status, { headers = {}, json } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => map.get(name.toLowerCase()) ?? null },
    json: async () => {
      if (json instanceof Error) throw json;
      return json;
    },
  };
}

const bodyOf = (call) => JSON.parse(new TextDecoder().decode(call[1].body));

describe('authClient', () => {
  it('is disabled under test (VITE_AUTH_ENABLED is only set for production and demo)', () => {
    expect(AUTH_ENABLED).toBe(false);
  });

  describe('probeSession', () => {
    it('sends HEAD for the first letter, same-origin, uncached', async () => {
      const fetchImpl = vi.fn(async () => response(200));
      await probeSession(fetchImpl);
      expect(fetchImpl).toHaveBeenCalledWith(dialogueUrl(0), {
        method: 'HEAD',
        credentials: 'same-origin',
        cache: 'no-store',
      });
    });
  });

  describe('startLogin', () => {
    it('POSTs the username and password as JSON to /api/login/start', async () => {
      const fetchImpl = vi.fn(async () => response(200, { json: { questions: ['q1', 'q2', 'q3'] } }));
      const result = await startLogin('Kelly', 'secret pw', fetchImpl);

      expect(result).toEqual({ ok: true, questions: ['q1', 'q2', 'q3'] });
      const [path, init] = fetchImpl.mock.calls[0];
      expect(path).toBe('/api/login/start');
      expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      expect(init.headers['content-type']).toBe('application/json');
      expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({ username: 'Kelly', password: 'secret pw' });
    });

    it.each([
      ['no questions field', {}],
      ['two questions', { questions: ['a', 'b'] }],
      ['a non-string question', { questions: ['a', 2, 'c'] }],
      ['an unparsable body', new SyntaxError('bad json')],
    ])('treats a 200 with %s as unavailable', async (_label, json) => {
      expect(await startLogin('u', 'p', async () => response(200, { json }))).toEqual({ ok: false, reason: 'unavailable' });
    });

    it('treats a 204 (no questions) as unavailable', async () => {
      expect(await startLogin('u', 'p', async () => response(204))).toEqual({ ok: false, reason: 'unavailable' });
    });
  });

  describe('finishLogin', () => {
    it('POSTs credentials and all three answers in one request', async () => {
      const fetchImpl = vi.fn(async () => response(204));
      expect(await finishLogin('Kelly', 'pw', ['one', 'two', 'three'], fetchImpl)).toEqual({ ok: true });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0][0]).toBe('/api/login/finish');
      expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({ username: 'Kelly', password: 'pw', answers: ['one', 'two', 'three'] });
    });

    it('a 429 without Retry-After is rate-limited with no wait time', async () => {
      expect(await finishLogin('u', 'p', ['a', 'b', 'c'], async () => response(429))).toEqual({ ok: false, reason: 'rate-limited' });
    });

    it('a 429 with an HTTP-date Retry-After becomes seconds', async () => {
      const at = new Date(Date.now() + 120_000).toUTCString();
      const result = await finishLogin('u', 'p', ['a', 'b', 'c'], async () => response(429, { headers: { 'Retry-After': at } }));
      expect(result.reason).toBe('rate-limited');
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(118);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(120);
    });
  });

  describe('parseRetryAfter', () => {
    it('reads delta seconds and HTTP dates, and ignores junk', () => {
      expect(parseRetryAfter('90')).toBe(90);
      expect(parseRetryAfter(' 7 ')).toBe(7);
      expect(parseRetryAfter('Thu, 01 Jan 2032 00:01:00 GMT', Date.parse('Thu, 01 Jan 2032 00:00:00 GMT'))).toBe(60);
      expect(parseRetryAfter('Thu, 01 Jan 2032 00:00:00 GMT', Date.parse('Fri, 02 Jan 2032 00:00:00 GMT'))).toBe(0);
      expect(parseRetryAfter('soon')).toBeUndefined();
      expect(parseRetryAfter('')).toBeUndefined();
      expect(parseRetryAfter(null)).toBeUndefined();
      expect(parseRetryAfter('-5')).toBeUndefined(); // Date.parse alone would read this as a year
      expect(parseRetryAfter('2')).toBe(2);
      expect(parseRetryAfter('May 5')).toBeUndefined();
    });
  });

  describe('sha256Hex', () => {
    it('matches the known digest of "abc"', async () => {
      expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });
  });
});
