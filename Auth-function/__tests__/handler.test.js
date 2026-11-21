import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createVerify } from 'node:crypto';
import { CREDENTIALS, makeAuthConfig, makeEnv, makeHarness, postEvent, rsaKey } from './helpers.js';
import { viewerIp } from '../src/handler.js';
import { ENV_NAMES } from '../src/config.js';

let env;
beforeAll(async () => {
  env = makeEnv(await makeAuthConfig());
});

const right = () => ({ username: ' KELLY ', password: CREDENTIALS.password, answers: ['Short Stack!', 'KODA', ' madison. '] });
const start = (h, body = { username: 'kelly', password: CREDENTIALS.password }, opts) =>
  h.handler(postEvent('/api/login/start', body, opts));
const finish = (h, body = right(), opts) => h.handler(postEvent('/api/login/finish', body, opts));

describe('handler', () => {
  describe('routes', () => {
    it('start with the right credentials returns 200 and the three prompts, and sets no cookie', async () => {
      const h = makeHarness(env);
      const res = await start(h);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ questions: CREDENTIALS.prompts });
      expect(res.cookies).toBeUndefined();
      expect(h.verifyFn).toHaveBeenCalledTimes(2);
    });

    it('finish with everything right returns 204 with exactly three cookies and an empty body', async () => {
      const h = makeHarness(env);
      const res = await finish(h);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(res.headers['content-type']).toBeUndefined();
      expect(res.cookies.map((c) => c.split('=')[0])).toEqual(['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id']);
      expect(h.verifyFn).toHaveBeenCalledTimes(5);
    });

    it('the cookies from finish carry a signature the public key verifies', async () => {
      const res = await finish(makeHarness(env));
      const value = (name) => res.cookies.find((c) => c.startsWith(`${name}=`)).split(';')[0].slice(name.length + 1);
      const decode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/'), 'base64');
      const policy = decode(value('CloudFront-Policy')).toString('utf8');
      expect(JSON.parse(policy).Statement[0].Resource).toBe('https://d123abc.cloudfront.net/Memories/*');
      expect(JSON.parse(policy).Statement[0].Condition.DateLessThan['AWS:EpochTime']).toBe(1_800_000_000 + 43200);
      const verifier = createVerify('RSA-SHA1');
      verifier.update(policy);
      expect(verifier.verify(rsaKey().publicKey, decode(value('CloudFront-Signature')))).toBe(true);
    });

    it.each([
      ['wrong username', { ...right(), username: 'kelley' }],
      ['password in the wrong case', { ...right(), password: CREDENTIALS.password.toLowerCase() }],
      ['one wrong answer', { ...right(), answers: ['short stack', 'rex', 'madison'] }],
      ['answers in the wrong order', { ...right(), answers: ['koda', 'short stack', 'madison'] }],
    ])('finish with %s returns 401 mismatch and counts one attempt', async (_label, body) => {
      const h = makeHarness(env);
      const res = await finish(h, body);
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ error: 'mismatch' });
      expect(res.cookies).toBeUndefined();
      expect(h.limiter.recordFailure).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['GET', '/api/login/start'],
      ['OPTIONS', '/api/login/finish'],
      ['POST', '/api/login'],
      ['POST', '/api/login/start/'],
      ['POST', '/Memories/dialogue/00.md'],
    ])('%s %s returns 404 without checking anything', async (method, path) => {
      const h = makeHarness(env);
      const res = await h.handler({ ...postEvent(path, { username: 'a', password: 'b' }), requestContext: { http: { method } } });
      expect(res.statusCode).toBe(404);
      expect(h.verifyFn).not.toHaveBeenCalled();
      expect(h.limiter.recordFailure).not.toHaveBeenCalled();
    });

    it('accepts a base64-encoded body', async () => {
      expect((await start(makeHarness(env), undefined, { base64: true })).statusCode).toBe(200);
    });
  });

  it('every response is Cache-Control: no-store', async () => {
    const h = makeHarness(env);
    const responses = [
      await start(h),
      await finish(h),
      await start(h, { username: 'x', password: 'y' }),
      await start(h, '{bad'),
      await h.handler({ rawPath: '/nope', requestContext: { http: { method: 'GET' } } }),
    ];
    for (const res of responses) expect(res.headers['cache-control']).toBe('no-store');
  });

  describe('attempt limit', () => {
    it('the 6th try after 5 failures gets 429 with Retry-After, without checking credentials', async () => {
      const h = makeHarness(env);
      for (let i = 0; i < 5; i += 1) expect((await start(h, { username: 'x', password: 'y' })).statusCode).toBe(401);
      h.verifyFn.mockClear();
      h.advance(60);
      const res = await start(h);
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe(String(900 - 60));
      expect(JSON.parse(res.body)).toEqual({ error: 'rate-limited' });
      expect(h.verifyFn).not.toHaveBeenCalled();
    });

    it('a successful finish clears that IP\'s failures', async () => {
      const h = makeHarness(env);
      for (let i = 0; i < 4; i += 1) await start(h, { username: 'x', password: 'y' });
      expect((await finish(h)).statusCode).toBe(204);
      expect(h.limiter.clear).toHaveBeenCalledWith('203.0.113.7');
      for (let i = 0; i < 4; i += 1) await start(h, { username: 'x', password: 'y' });
      expect((await start(h)).statusCode).toBe(200); // 4 new failures, not 8
    });

    it('a successful start does not clear failures (only finish does)', async () => {
      const h = makeHarness(env);
      for (let i = 0; i < 4; i += 1) await start(h, { username: 'x', password: 'y' });
      expect((await start(h)).statusCode).toBe(200);
      expect(h.limiter.clear).not.toHaveBeenCalled();
      await start(h, { username: 'x', password: 'y' });
      expect((await start(h)).statusCode).toBe(429);
    });

    it('failures from one IP never lock another', async () => {
      const h = makeHarness(env);
      for (let i = 0; i < 10; i += 1) await start(h, { username: 'x', password: 'y' }, { ip: '198.51.100.99' });
      expect((await start(h, undefined, { ip: '203.0.113.7' })).statusCode).toBe(200);
    });
  });

  describe('configuration problems', () => {
    it.each(ENV_NAMES)('a missing %s returns 503 and logs the name, never a value', async (name) => {
      const h = makeHarness({ ...env, [name]: undefined });
      const res = await start(h);
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toEqual({ error: 'unavailable' });
      const log = JSON.parse(h.logs.at(-1));
      expect(log.outcome).toBe('error');
      expect(log.config.join(' ')).toContain(name);
      for (const value of Object.values(env)) expect(h.logs.join('\n')).not.toContain(value);
    });

    it.each([
      ['AUTH_CONFIG', '{not json'],
      ['AUTH_CONFIG', JSON.stringify({ version: 1 })],
      ['CLOUDFRONT_PRIVATE_KEY_B64', Buffer.from('not a key').toString('base64')],
      ['CLOUDFRONT_KEY_PAIR_ID', 'lowercase'],
      ['APP_DOMAIN', 'https://d1.cloudfront.net/'],
    ])('a malformed %s returns 503', async (name, value) => {
      const h = makeHarness({ ...env, [name]: value });
      expect((await finish(h)).statusCode).toBe(503);
      expect(JSON.parse(h.logs.at(-1)).config.join(' ')).toContain(name);
      expect(h.logs.join('\n')).not.toContain(value);
    });

    it('validates the environment once per handler (one Lambda instance)', async () => {
      const liveEnv = { ...env };
      const h = makeHarness(liveEnv);
      expect((await start(h)).statusCode).toBe(200);
      liveEnv.APP_DOMAIN = '';
      expect((await start(h)).statusCode).toBe(200);
    });

    it('a failure while signing returns 503 and logs only the error name', async () => {
      const h = makeHarness(env, {
        signCookies: vi.fn(() => {
          throw new TypeError(`secret detail ${CREDENTIALS.password}`);
        }),
      });
      const res = await finish(h);
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(h.logs.at(-1))).toMatchObject({ outcome: 'error', error: 'TypeError' });
      expect(h.logs.join('\n')).not.toContain('secret detail');
    });

    it('bad requests are answered before the config is even read', async () => {
      const h = makeHarness({});
      expect((await start(h, '{bad')).statusCode).toBe(400);
    });
  });

  describe('viewerIp', () => {
    it.each([
      [{ headers: { 'cloudfront-viewer-address': '203.0.113.7:443' } }, '203.0.113.7'],
      [{ headers: { 'cloudfront-viewer-address': '2001:db8::1:51234' } }, '2001:db8::1'],
      [{ headers: { 'cloudfront-viewer-address': '[2001:db8::2]:51234' } }, '2001:db8::2'],
      [{ headers: { 'CloudFront-Viewer-Address': '192.0.2.4:1' } }, '192.0.2.4'],
      [{ headers: {}, requestContext: { http: { sourceIp: '192.0.2.9' } } }, '192.0.2.9'],
      [{}, 'unknown'],
    ])('reads %j as %s', (event, expected) => {
      expect(viewerIp(event)).toBe(expected);
    });
  });
});
