// @vitest-environment node
// The demo plugin runs in the Vite dev server (Node), so these tests do too.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import http from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import authDemoPlugin, {
  bodyHashMatches,
  checkAccessCookies,
  decodeCloudFrontBase64,
  parseCookies,
  resourceMatches,
  DEMO_APP_DOMAIN,
  DEMO_KEY_PAIR_ID,
} from '../authDemoPlugin.js';
import { buildAccessCookies } from '../../../Auth-function/src/cookies.js';
import { hash } from '../../../Auth-function/src/hashing.js';

const FAST = { N: 16, r: 1, p: 1 };
const NOW = 1_800_000_000;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const silent = { info() {}, warn() {} };

/** A demo key pair and a signer for cookies the way the handler makes them. */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
function cookieHeader({ appDomain = DEMO_APP_DOMAIN, keyPairId = DEMO_KEY_PAIR_ID, nowSeconds = NOW, key = pem } = {}) {
  return buildAccessCookies({ appDomain, keyPairId, privateKey: key, nowSeconds })
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** Start the plugin against a bare HTTP server; the fallback stands in for Vite's static files. */
async function startDemo(plugin) {
  const stack = [];
  await plugin.configureServer({ middlewares: { use: (fn) => stack.push(fn) } });
  const server = http.createServer((req, res) => {
    let i = 0;
    const next = () => {
      const fn = stack[i++];
      if (fn) return fn(req, res, next);
      res.statusCode = req.url.endsWith('/99.md') ? 404 : 200;
      return res.end(req.method === 'HEAD' ? '' : 'STATIC');
    };
    next();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

function post(base, path, payload, { hashHeader } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-amz-content-sha256': hashHeader ?? sha(body) },
    body,
  });
}

let dir;
let configPath;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'museum-demo-test-'));
  configPath = join(dir, 'auth-config.local.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      version: 1,
      usernameHash: await hash('kelly', FAST),
      passwordHash: await hash('pw', FAST),
      questions: await Promise.all(['a', 'b', 'c'].map(async (a, i) => ({ prompt: `Q${i + 1}`, answerHash: await hash(a, FAST) }))),
    }),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('authDemoPlugin helpers', () => {
  it('parseCookies reads name=value pairs', () => {
    expect(parseCookies('a=1; b=two=2;  c = 3 ')).toEqual({ a: '1', b: 'two=2', c: '3' });
    expect(parseCookies(undefined)).toEqual({});
  });

  it('resourceMatches treats * as a wildcard and nothing else as special', () => {
    expect(resourceMatches('https://localhost/Memories/*', 'https://localhost/Memories/photos/00.jpg')).toBe(true);
    expect(resourceMatches('https://localhost/Memories/*', 'https://localhost/Other/x')).toBe(false);
    expect(resourceMatches('https://localhost/Memories/*', 'https://localhostXcom/Memories/x')).toBe(false);
  });

  it('decodeCloudFrontBase64 reverses CloudFront\'s URL-safe base64', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        const safe = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
        expect([...decodeCloudFrontBase64(safe)]).toEqual([...bytes]);
      }),
    );
  });

  it('bodyHashMatches is true only for the hex SHA-256 of the exact body', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), fc.string({ maxLength: 80 }), (body, other) => {
        expect(bodyHashMatches(Buffer.from(body), sha(body))).toBe(true);
        expect(bodyHashMatches(Buffer.from(body), sha(body).toUpperCase())).toBe(true);
        if (other !== body) expect(bodyHashMatches(Buffer.from(body), sha(other))).toBe(false);
      }),
    );
    expect(bodyHashMatches(Buffer.from('x'), undefined)).toBe(false);
  }, 30_000); // can exceed the 5 s default under full-suite load
});

describe('checkAccessCookies (the CloudFront stand-in)', () => {
  const opts = { publicKey, pathname: '/Memories/dialogue/00.md', nowSeconds: NOW + 60 };

  it('accepts cookies the handler signed, inside the 12-hour window', () => {
    expect(checkAccessCookies(cookieHeader(), opts)).toEqual({ ok: true });
    expect(checkAccessCookies(cookieHeader(), { ...opts, pathname: '/Memories/photos/31.jpg' })).toEqual({ ok: true });
  });

  it.each([
    ['no cookies', '', 'missing cookie'],
    ['a missing cookie', () => cookieHeader().replace(/; CloudFront-Key-Pair-Id=[^;]*/, ''), 'missing cookie'],
    ['another key pair ID', () => cookieHeader({ keyPairId: 'OTHER' }), 'unknown key pair'],
    ['a different signing key', () => cookieHeader({ key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) }), 'bad signature'],
    ['an expired policy', () => cookieHeader({ nowSeconds: NOW - 12 * 3600 }), 'expired'],
    ['a policy for another host', () => cookieHeader({ appDomain: 'example.com' }), 'wrong resource'],
  ])('rejects %s', (_label, header, reason) => {
    const value = typeof header === 'function' ? header() : header;
    expect(checkAccessCookies(value, opts)).toEqual({ ok: false, reason });
  });

  it('rejects a path outside /Memories', () => {
    expect(checkAccessCookies(cookieHeader(), { ...opts, pathname: '/api/login/start' })).toEqual({ ok: false, reason: 'wrong resource' });
  });

  it('expires exactly at DateLessThan', () => {
    expect(checkAccessCookies(cookieHeader(), { ...opts, nowSeconds: NOW + 12 * 3600 - 1 }).ok).toBe(true);
    expect(checkAccessCookies(cookieHeader(), { ...opts, nowSeconds: NOW + 12 * 3600 })).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects any single-character change that alters the decoded policy or signature', () => {
    const good = parseCookies(cookieHeader());
    fc.assert(
      fc.property(fc.constantFrom('CloudFront-Policy', 'CloudFront-Signature'), fc.nat(), fc.constantFrom('A', 'B', '-', '~'), (name, pos, ch) => {
        const value = good[name];
        const at = pos % value.length;
        const tampered = value.slice(0, at) + ch + value.slice(at + 1);
        // Base64 padding and trailing bits can change without changing the decoded bytes;
        // such a change is not tampering (CloudFront also compares decoded bytes).
        fc.pre(!decodeCloudFrontBase64(tampered).equals(decodeCloudFrontBase64(value)));
        const changed = { ...good, [name]: tampered };
        const header = Object.entries(changed).map(([k, v]) => `${k}=${v}`).join('; ');
        expect(checkAccessCookies(header, opts).ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

describe('authDemoPlugin end to end (real handler, local HTTP server)', () => {
  let demo;
  beforeAll(async () => {
    demo = await startDemo(authDemoPlugin({ demoConfigPath: configPath, logger: silent }));
  });
  afterAll(() => demo.close());

  it('is a dev-server-only plugin', () => {
    const plugin = authDemoPlugin({ demoConfigPath: configPath, logger: silent });
    expect(plugin.apply).toBe('serve');
    expect(plugin.name).toBe('museum-auth-demo');
  });

  it('blocks /Memories/* before sign-in, and passes other paths through', async () => {
    expect((await fetch(`${demo.base}/Memories/dialogue/00.md`, { method: 'HEAD' })).status).toBe(403);
    expect((await fetch(`${demo.base}/Memories/photos/00.jpg`)).status).toBe(403);
    const page = await fetch(`${demo.base}/index.html`);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('STATIC');
  });

  it('rejects a POST whose x-amz-content-sha256 is missing or wrong, before the handler', async () => {
    const body = { username: 'kelly', password: 'pw' };
    expect((await post(demo.base, '/api/login/start', body, { hashHeader: sha('something else') })).status).toBe(403);
    const noHeader = await fetch(`${demo.base}/api/login/start`, { method: 'POST', body: JSON.stringify(body) });
    expect(noHeader.status).toBe(403);
  });

  it('a full sign-in sets three cookies that unlock /Memories/*, and a missing file is 404', async () => {
    const start = await post(demo.base, '/api/login/start', { username: 'Kelly', password: 'pw' });
    expect(start.status).toBe(200);
    expect((await start.json()).questions).toEqual(['Q1', 'Q2', 'Q3']);
    expect(start.headers.get('cache-control')).toBe('no-store');

    const finish = await post(demo.base, '/api/login/finish', { username: 'kelly', password: 'pw', answers: ['A!', 'b', ' c '] });
    expect(finish.status).toBe(204);
    const setCookies = finish.headers.getSetCookie();
    expect(setCookies.map((c) => c.split('=')[0])).toEqual(['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id']);
    for (const c of setCookies) expect(c).toMatch(/; Path=\/Memories; Secure; HttpOnly; SameSite=Strict$/);

    const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    expect((await fetch(`${demo.base}/Memories/dialogue/00.md`, { method: 'HEAD', headers: { cookie } })).status).toBe(200);
    expect(await (await fetch(`${demo.base}/Memories/photos/00.jpg`, { headers: { cookie } })).text()).toBe('STATIC');
    expect((await fetch(`${demo.base}/Memories/dialogue/99.md`, { headers: { cookie } })).status).toBe(404);
  });

  it('passes handler errors through unchanged (401 on a wrong answer, 404 on unknown routes)', async () => {
    const wrong = await post(demo.base, '/api/login/finish', { username: 'kelly', password: 'pw', answers: ['x', 'b', 'c'] });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.getSetCookie()).toEqual([]);
    expect((await fetch(`${demo.base}/api/nope`)).status).toBe(404);
  });

  it('cookies from an earlier dev-server run stop working after a restart (new demo key)', async () => {
    const finish = await post(demo.base, '/api/login/finish', { username: 'kelly', password: 'pw', answers: ['a', 'b', 'c'] });
    const cookie = finish.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const restarted = await startDemo(authDemoPlugin({ demoConfigPath: configPath, logger: silent }));
    try {
      expect((await fetch(`${restarted.base}/Memories/dialogue/00.md`, { headers: { cookie } })).status).toBe(403);
    } finally {
      await restarted.close();
    }
  });
});

describe('missing Demo_Config', () => {
  it('starts anyway, prints how to create it, and every sign-in returns 503', async () => {
    const warnings = [];
    const demo = await startDemo(authDemoPlugin({ demoConfigPath: join(dir, 'missing.json'), logger: { info() {}, warn: (m) => warnings.push(m) } }));
    try {
      expect(warnings.join('\n')).toContain('node tools/make-config.mjs --demo');
      expect((await post(demo.base, '/api/login/start', { username: 'kelly', password: 'pw' })).status).toBe(503);
    } finally {
      await demo.close();
    }
  });
});

describe('production build', () => {
  it('contains none of the demo plugin', async () => {
    const { build } = await import('vite');
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const result = await build({ root, mode: 'production', logLevel: 'silent', build: { write: false } });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
    const code = outputs.map((o) => (o.type === 'chunk' ? o.code : String(o.source))).join('\n');
    expect(code.length).toBeGreaterThan(1000);
    expect(code).not.toContain('museum-auth-demo');
    expect(code).not.toContain('demo CloudFront');
    expect(code).not.toContain('auth-config.local.json');
    // The production build does turn the login on.
    expect(code).toContain('/api/login');
  }, 180_000);
});
