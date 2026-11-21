/**
 * Shared test fixtures (not a test file). A hashed Auth_Config at low scrypt cost, a real
 * RSA key, a matching environment, and a builder for function-URL events.
 */
import { generateKeyPairSync } from 'node:crypto';
import { vi } from 'vitest';
import { hash, verify } from '../src/hashing.js';
import { normalizeAnswer, normalizeUsername } from '../src/normalize.js';
import { createLimiter } from '../src/limiter.js';
import { createHandler } from '../src/handler.js';

/** Low cost: the handler's verify reads N from each stored hash, so this stays fast. */
export const FAST = { N: 16, r: 1, p: 1 };

export const CREDENTIALS = Object.freeze({
  username: 'Kelly',
  password: 'Pass Word!',
  prompts: ['Where was our first brunch?', "What is our dog's name?", 'Where did we meet?'],
  answers: ['short stack', 'koda', 'madison'],
});

let keyCache = null;
/** One real 2048-bit RSA key per test file. */
export function rsaKey() {
  if (!keyCache) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    keyCache = { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey };
  }
  return keyCache;
}

/** Build a hashed Auth_Config the way the setup tool does. */
export async function makeAuthConfig({ username, password, prompts, answers } = CREDENTIALS) {
  return {
    version: 1,
    usernameHash: await hash(normalizeUsername(username), FAST),
    passwordHash: await hash(password, FAST),
    questions: await Promise.all(
      prompts.map(async (prompt, i) => ({ prompt, answerHash: await hash(normalizeAnswer(answers[i]), FAST) })),
    ),
  };
}

/** A complete, valid Lambda environment for `authConfig`. */
export function makeEnv(authConfig) {
  return {
    AUTH_CONFIG: JSON.stringify(authConfig),
    CLOUDFRONT_PRIVATE_KEY_B64: Buffer.from(rsaKey().pem).toString('base64'),
    CLOUDFRONT_KEY_PAIR_ID: 'K2JCJMDEHXQW5F',
    APP_DOMAIN: 'd123abc.cloudfront.net',
  };
}

/** A POST function-URL event as CloudFront delivers it. */
export function postEvent(path, body, { ip = '203.0.113.7', base64 = false, headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    rawPath: path,
    requestContext: { http: { method: 'POST', sourceIp: '198.51.100.1' } },
    headers: { 'cloudfront-viewer-address': `${ip}:51234`, ...headers },
    body: base64 ? Buffer.from(text).toString('base64') : text,
    isBase64Encoded: base64,
  };
}

/**
 * A handler with spies on everything observable: verify calls, limiter calls, log lines.
 * @param {object} [overrides] - createHandler options to override
 */
export function makeHarness(env, overrides = {}) {
  const limiter = createLimiter();
  vi.spyOn(limiter, 'recordFailure');
  vi.spyOn(limiter, 'clear');
  const verifyFn = vi.fn((input, stored) => verify(input, stored));
  const logs = [];
  let clock = 1_800_000_000;
  const handler = createHandler({
    env,
    now: () => clock,
    limiter,
    verifyFn,
    log: (line) => logs.push(line),
    ...overrides,
  });
  return {
    handler,
    limiter,
    verifyFn,
    logs,
    advance: (seconds) => {
      clock += seconds;
    },
  };
}
