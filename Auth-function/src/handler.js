/**
 * handler.js — the museum login Lambda (function URL, behind CloudFront at /api/*).
 *
 *   POST /api/login/start   { username, password }             -> 200 { questions: [3] }
 *   POST /api/login/finish  { username, password, answers[3] } -> 204 + 3 Set-Cookie
 *
 * Order per request: validate the body (400, not counted) -> attempt-limit gate (429) ->
 * load config (503 if bad) -> run every check -> 401 (counted) or success. Every response
 * is `Cache-Control: no-store`. Logs carry only route, outcome and duration; never the
 * body, the IP, a hash, or any config value.
 *
 * `createHandler()` takes its environment, clock, signer, limiter and verify function as
 * options so tests and the local Demo_Mode can run the exact same code.
 * Requirements: 4.5–4.8, 5.1, 5.6, 8.1–8.4, 9.5.
 */

import { getSignedCookies } from '@aws-sdk/cloudfront-signer';
import { checkAll, checkCredentials } from './checks.js';
import { buildAccessCookies } from './cookies.js';
import { loadConfig } from './config.js';
import { verify } from './hashing.js';
import { limiter as sharedLimiter } from './limiter.js';

/** Largest accepted request body, in bytes (Req 4.8). */
export const MAX_BODY_BYTES = 4096;

const ROUTES = Object.freeze({
  '/api/login/start': 'start',
  '/api/login/finish': 'finish',
});

/**
 * @param {number} statusCode
 * @param {object|null} body
 * @param {Record<string,string>} [headers]
 * @param {string[]} [cookies]
 */
function respond(statusCode, body, headers = {}, cookies) {
  const response = {
    statusCode,
    headers: { 'cache-control': 'no-store', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : '',
  };
  if (cookies) response.cookies = cookies;
  return response;
}

/**
 * The viewer IP. CloudFront sends `CloudFront-Viewer-Address: <ip>:<port>` (IPv6 without
 * brackets), so the port is everything after the last colon.
 * @param {object} event
 * @returns {string}
 */
export function viewerIp(event) {
  const headers = event?.headers || {};
  const raw = headers['cloudfront-viewer-address'] ?? headers['CloudFront-Viewer-Address'];
  if (typeof raw === 'string' && raw.includes(':')) {
    const ip = raw.slice(0, raw.lastIndexOf(':')).replace(/^\[|\]$/g, '');
    if (ip) return ip;
  }
  const sourceIp = event?.requestContext?.http?.sourceIp;
  return typeof sourceIp === 'string' && sourceIp ? sourceIp : 'unknown';
}

/**
 * Parse and validate the request body for a route. Returns the fields or null.
 * @param {object} event
 * @param {'start'|'finish'} route
 */
export function parseBody(event, route) {
  if (typeof event?.body !== 'string') return null;
  const bytes = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8');
  if (bytes.length === 0 || bytes.length > MAX_BODY_BYTES) return null;

  let data;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { username, password, answers } = data;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  if (route === 'start') return { username, password };
  if (!Array.isArray(answers) || answers.length !== 3 || !answers.every((a) => typeof a === 'string')) return null;
  return { username, password, answers };
}

/**
 * Build a handler. Options default to the real Lambda environment.
 *
 * @param {object} [options]
 * @param {Record<string,string|undefined>} [options.env=process.env]
 * @param {() => number} [options.now] - epoch seconds
 * @param {typeof getSignedCookies} [options.signCookies]
 * @param {ReturnType<import('./limiter.js').createLimiter>} [options.limiter]
 * @param {import('./checks.js').VerifyFn} [options.verifyFn]
 * @param {(line:string) => void} [options.log]
 */
export function createHandler({
  env = process.env,
  now = () => Date.now() / 1000,
  signCookies = getSignedCookies,
  limiter = sharedLimiter,
  verifyFn = verify,
  log = (line) => console.log(line),
} = {}) {
  let config = null; // validated once per handler (one Lambda instance)
  const getConfig = () => {
    if (!config) config = loadConfig(env);
    return config;
  };

  return async function handler(event) {
    const startedMs = Date.now();
    const method = event?.requestContext?.http?.method;
    const route = ROUTES[event?.rawPath];
    const finish = (outcome, response, extra = {}) => {
      log(JSON.stringify({ route: route ?? 'unknown', outcome, ms: Date.now() - startedMs, ...extra }));
      return response;
    };

    if (method !== 'POST' || !route) {
      return finish('not-found', respond(404, { error: 'not-found' }));
    }

    const fields = parseBody(event, route);
    if (!fields) return finish('invalid', respond(400, { error: 'bad-request' }));

    const ip = viewerIp(event);
    const nowSeconds = now();
    const lock = limiter.isLocked(ip, nowSeconds);
    if (lock.locked) {
      return finish('limited', respond(429, { error: 'rate-limited' }, { 'retry-after': String(lock.retryAfterSeconds) }));
    }

    const loaded = getConfig();
    if (!loaded.ok) {
      // Names of the bad variables only; never their values.
      return finish('error', respond(503, { error: 'unavailable' }), { config: loaded.problems });
    }
    const { authConfig, privateKey, keyPairId, appDomain } = loaded.value;

    try {
      const ok =
        route === 'start'
          ? await checkCredentials(authConfig, fields.username, fields.password, { verifyFn })
          : await checkAll(authConfig, fields, { verifyFn });

      if (!ok) {
        limiter.recordFailure(ip, nowSeconds);
        return finish('mismatch', respond(401, { error: 'mismatch' }));
      }

      if (route === 'start') {
        return finish('ok', respond(200, { questions: authConfig.questions.map((q) => q.prompt) }));
      }

      const cookies = buildAccessCookies({ appDomain, keyPairId, privateKey, nowSeconds, signCookies });
      limiter.clear(ip);
      return finish('ok', respond(204, null, {}, cookies));
    } catch (err) {
      return finish('error', respond(503, { error: 'unavailable' }), { error: err?.name || 'Error' });
    }
  };
}

/** The Lambda entry point (`handler.handler`). */
export const handler = createHandler();
