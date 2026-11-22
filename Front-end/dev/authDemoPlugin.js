/**
 * authDemoPlugin.js — Demo_Mode for `npm run dev:auth` (dev server only, never bundled).
 *
 * Stands in for the two AWS pieces so the whole sign-in runs locally:
 *
 * - Lambda: `/api/*` runs the REAL handler from `Auth-function/src/handler.js`, after the
 *   same `x-amz-content-sha256` body-hash check Lambda applies behind CloudFront + OAC.
 * - CloudFront: `/Memories/*` needs the three signed cookies. Their signature is verified
 *   against a demo key generated when the dev server starts (in memory only), and the
 *   policy's expiry and resource are checked. Otherwise the request gets 403.
 *
 * The handler signs `https://localhost/Memories/*` exactly as it would in production; the
 * stand-in checks against that, so the dev server's real port doesn't matter.
 * Requirements: 11.1–11.7.
 */

import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';

/** Host the demo signs for (APP_DOMAIN). */
export const DEMO_APP_DOMAIN = 'localhost';
/** Key pair ID the demo signs with (CLOUDFRONT_KEY_PAIR_ID). */
export const DEMO_KEY_PAIR_ID = 'DEMO';

const AUTH_FUNCTION_DIR = fileURLToPath(new URL('../../Auth-function/', import.meta.url));
export const DEFAULT_DEMO_CONFIG_PATH = `${AUTH_FUNCTION_DIR}demo/auth-config.local.json`;
const HANDLER_PATH = `${AUTH_FUNCTION_DIR}src/handler.js`;

/** Requests bigger than this are cut off before they reach the handler. */
const MAX_READ_BYTES = 64 * 1024;

/** CloudFront's URL-safe base64 (`-` `_` `~`) back to standard base64 bytes. */
export function decodeCloudFrontBase64(value) {
  return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/'), 'base64');
}

/** @param {string|undefined} header */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

/** CloudFront resource wildcard match: `*` matches any run of characters. */
export function resourceMatches(pattern, url) {
  const escaped = String(pattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.*')}$`).test(url);
}

/**
 * Would CloudFront serve `pathname` to a request with these cookies?
 *
 * @param {string|undefined} cookieHeader
 * @param {object} opts
 * @param {import('node:crypto').KeyObject|string} opts.publicKey
 * @param {string} opts.pathname - e.g. `/Memories/dialogue/00.md`
 * @param {number} opts.nowSeconds
 * @param {string} [opts.keyPairId]
 * @param {string} [opts.appDomain]
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
export function checkAccessCookies(cookieHeader, { publicKey, pathname, nowSeconds, keyPairId = DEMO_KEY_PAIR_ID, appDomain = DEMO_APP_DOMAIN }) {
  const cookies = parseCookies(cookieHeader);
  const policyValue = cookies['CloudFront-Policy'];
  const signature = cookies['CloudFront-Signature'];
  const pairId = cookies['CloudFront-Key-Pair-Id'];
  if (!policyValue || !signature || !pairId) return { ok: false, reason: 'missing cookie' };
  if (pairId !== keyPairId) return { ok: false, reason: 'unknown key pair' };

  const policy = decodeCloudFrontBase64(policyValue).toString('utf8');
  const verifier = createVerify('RSA-SHA1');
  verifier.update(policy);
  let signed;
  try {
    signed = verifier.verify(publicKey, decodeCloudFrontBase64(signature));
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, reason: 'bad signature' };

  let statement;
  try {
    [statement] = JSON.parse(policy).Statement;
  } catch {
    return { ok: false, reason: 'bad policy' };
  }
  const expires = statement?.Condition?.DateLessThan?.['AWS:EpochTime'];
  if (typeof expires !== 'number' || nowSeconds >= expires) return { ok: false, reason: 'expired' };
  if (!resourceMatches(statement?.Resource, `https://${appDomain}${pathname}`)) return { ok: false, reason: 'wrong resource' };
  return { ok: true };
}

/** True when `header` is the lowercase hex SHA-256 of `body`. */
export function bodyHashMatches(body, header) {
  if (typeof header !== 'string') return false;
  return createHash('sha256').update(body).digest('hex') === header.trim().toLowerCase();
}

/** Read the request body (capped). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_READ_BYTES) chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Turn a Node request into a Lambda function-URL event, as CloudFront would deliver it.
 * @param {import('node:http').IncomingMessage} req
 * @param {Buffer} body
 */
export function toLambdaEvent(req, body) {
  const url = new URL(req.url, 'http://localhost');
  const ip = req.socket?.remoteAddress || '127.0.0.1';
  return {
    rawPath: url.pathname,
    requestContext: { http: { method: req.method, sourceIp: ip } },
    headers: { ...req.headers, 'cloudfront-viewer-address': `${ip}:${req.socket?.remotePort ?? 0}` },
    body: body.toString('utf8'),
    isBase64Encoded: false,
  };
}

/** Write a Lambda function-URL result to a Node response. */
function writeLambdaResult(res, result) {
  res.statusCode = result.statusCode;
  for (const [name, value] of Object.entries(result.headers || {})) res.setHeader(name, value);
  if (Array.isArray(result.cookies) && result.cookies.length > 0) res.setHeader('set-cookie', result.cookies);
  res.end(result.body || '');
}

function deny(res, status, message) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(message);
}

/**
 * The Connect middleware: Lambda stand-in for /api/*, CloudFront stand-in for /Memories/*.
 *
 * @param {object} deps
 * @param {(event:object) => Promise<object>} deps.handler - the real login handler
 * @param {import('node:crypto').KeyObject|string} deps.publicKey - demo public key
 * @param {() => number} [deps.now] - epoch seconds
 */
export function createDemoMiddleware({ handler, publicKey, now = () => Date.now() / 1000 }) {
  return async function demoMiddleware(req, res, next) {
    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        const body = await readBody(req);
        // Lambda behind CloudFront + OAC refuses a POST whose body hash header is wrong.
        if (req.method === 'POST' && !bodyHashMatches(body, req.headers['x-amz-content-sha256'])) {
          deny(res, 403, 'The request body hash does not match x-amz-content-sha256.');
          return;
        }
        writeLambdaResult(res, await handler(toLambdaEvent(req, body)));
      } catch {
        deny(res, 502, 'Demo login handler failed.');
      }
      return;
    }

    if (pathname === '/Memories' || pathname.startsWith('/Memories/')) {
      const access = checkAccessCookies(req.headers.cookie, { publicKey, pathname, nowSeconds: now() });
      if (!access.ok) {
        deny(res, 403, 'Access denied (demo CloudFront: sign in first).');
        return;
      }
    }

    next();
  };
}

/**
 * Load the Demo_Config file. Missing or unreadable -> null (sign-in then returns 503).
 * @param {string} path
 * @returns {string|null} the AUTH_CONFIG JSON text
 */
export function readDemoConfig(path) {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * The Vite plugin. Only active for the dev server (`apply: 'serve'`), and only added by
 * vite.config.js in `--mode demo`.
 *
 * @param {{demoConfigPath?: string, logger?: {info:Function, warn:Function}}} [options]
 */
export default function authDemoPlugin({ demoConfigPath = DEFAULT_DEMO_CONFIG_PATH, logger = console } = {}) {
  return {
    name: 'museum-auth-demo',
    apply: 'serve',
    async configureServer(server) {
      // Throwaway demo key, regenerated on every start and never written to disk.
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

      const authConfig = readDemoConfig(demoConfigPath);
      if (!authConfig) {
        logger.warn(
          '\n[museum-auth-demo] No demo login found. Create one, then restart:\n' +
            '  cd ../Auth-function && node tools/make-config.mjs --demo\n' +
            '  (Until then every sign-in returns "having trouble opening its doors".)\n',
        );
      }

      let createHandler;
      try {
        ({ createHandler } = await import(pathToFileURL(HANDLER_PATH).href));
      } catch (err) {
        throw new Error(
          `[museum-auth-demo] Could not load ${HANDLER_PATH}. Run "npm install" in Auth-function/ first. (${err.message})`,
          { cause: err },
        );
      }

      const handler = createHandler({
        env: {
          AUTH_CONFIG: authConfig ?? '',
          CLOUDFRONT_PRIVATE_KEY_B64: Buffer.from(pem).toString('base64'),
          CLOUDFRONT_KEY_PAIR_ID: DEMO_KEY_PAIR_ID,
          APP_DOMAIN: DEMO_APP_DOMAIN,
        },
      });

      // Added directly (not returned), so it runs before Vite serves /Memories/* files.
      server.middlewares.use(createDemoMiddleware({ handler, publicKey }));
      logger.info(
        '\n[museum-auth-demo] Demo login is on: /api/* runs the real login handler, /Memories/* needs sign-in.\n' +
          '  Use Chrome or Firefox (Safari rejects Secure cookies on http://localhost).\n',
      );
    },
  };
}
