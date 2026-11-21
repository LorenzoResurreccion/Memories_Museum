/**
 * config.js — read and validate the Lambda environment variables, once per instance.
 *
 * | Variable                     | Secret | Value                                         |
 * | ---------------------------- | ------ | --------------------------------------------- |
 * | `AUTH_CONFIG`                | yes    | hashed Auth_Config JSON, one line             |
 * | `CLOUDFRONT_PRIVATE_KEY_B64` | yes    | CloudFront private key PEM, base64 on one line |
 * | `CLOUDFRONT_KEY_PAIR_ID`     | no     | public key ID from the CloudFront key group   |
 * | `APP_DOMAIN`                 | no     | CloudFront host, e.g. `d123abc.cloudfront.net` |
 *
 * Problems are reported by variable NAME and a short reason, never the value, so the
 * handler can log them safely (Req 9.5). Requirements: 9.1, 9.5, 9.6.
 */

import { createPrivateKey } from 'node:crypto';
import { parseHash } from './hashing.js';

export const ENV_NAMES = Object.freeze(['AUTH_CONFIG', 'CLOUDFRONT_PRIVATE_KEY_B64', 'CLOUDFRONT_KEY_PAIR_ID', 'APP_DOMAIN']);

/**
 * @typedef {import('./checks.js').AuthConfig} AuthConfig
 * @typedef {{authConfig:AuthConfig, privateKey:string, keyPairId:string, appDomain:string}} LoadedConfig
 * @typedef {{ok:true, value:LoadedConfig} | {ok:false, problems:string[]}} ConfigResult
 */

/**
 * Validate the parsed Auth_Config shape. Returns a reason string, or null when valid.
 * @param {unknown} cfg
 * @returns {string|null}
 */
export function authConfigProblem(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return 'is not a JSON object';
  if (cfg.version !== 1) return 'has an unsupported version';
  if (!parseHash(cfg.usernameHash)) return 'has an invalid usernameHash';
  if (!parseHash(cfg.passwordHash)) return 'has an invalid passwordHash';
  if (!Array.isArray(cfg.questions) || cfg.questions.length !== 3) return 'must have exactly 3 questions';
  for (let i = 0; i < 3; i += 1) {
    const q = cfg.questions[i];
    if (!q || typeof q.prompt !== 'string' || q.prompt.trim() === '') return `question ${i + 1} has no prompt`;
    if (!parseHash(q.answerHash)) return `question ${i + 1} has an invalid answerHash`;
  }
  return null;
}

/**
 * Pure: parse and validate the environment. Never throws.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {ConfigResult}
 */
export function loadConfig(env) {
  const source = env || {};
  const problems = [];
  const missing = (name) => typeof source[name] !== 'string' || source[name].trim() === '';

  let authConfig;
  if (missing('AUTH_CONFIG')) {
    problems.push('AUTH_CONFIG is missing');
  } else {
    try {
      authConfig = JSON.parse(source.AUTH_CONFIG);
      const problem = authConfigProblem(authConfig);
      if (problem) problems.push(`AUTH_CONFIG ${problem}`);
    } catch {
      problems.push('AUTH_CONFIG is not valid JSON');
    }
  }

  let privateKey;
  if (missing('CLOUDFRONT_PRIVATE_KEY_B64')) {
    problems.push('CLOUDFRONT_PRIVATE_KEY_B64 is missing');
  } else {
    const pem = Buffer.from(source.CLOUDFRONT_PRIVATE_KEY_B64.trim(), 'base64').toString('utf8');
    try {
      if (!pem.includes('-----BEGIN')) throw new Error('not PEM');
      const key = createPrivateKey(pem);
      if (key.asymmetricKeyType !== 'rsa') throw new Error('not RSA');
      privateKey = pem;
    } catch {
      problems.push('CLOUDFRONT_PRIVATE_KEY_B64 is not a base64-encoded RSA private key PEM');
    }
  }

  const keyPairId = typeof source.CLOUDFRONT_KEY_PAIR_ID === 'string' ? source.CLOUDFRONT_KEY_PAIR_ID.trim() : '';
  if (!keyPairId) problems.push('CLOUDFRONT_KEY_PAIR_ID is missing');
  else if (!/^[A-Z0-9]+$/.test(keyPairId)) problems.push('CLOUDFRONT_KEY_PAIR_ID must be uppercase letters and digits');

  const appDomain = typeof source.APP_DOMAIN === 'string' ? source.APP_DOMAIN.trim() : '';
  if (!appDomain) problems.push('APP_DOMAIN is missing');
  else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(appDomain)) {
    problems.push('APP_DOMAIN must be a bare host name (no https://, port or path)');
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { authConfig, privateKey, keyPairId, appDomain } };
}

/**
 * Cached per instance: the first call validates; later calls reuse the result. Lambda
 * starts a fresh instance when environment variables change, so this never goes stale.
 *
 * @returns {(env?: Record<string, string|undefined>) => ConfigResult}
 */
export function createConfigCache() {
  let cached = null;
  return (env = process.env) => {
    if (!cached) cached = loadConfig(env);
    return cached;
  };
}
