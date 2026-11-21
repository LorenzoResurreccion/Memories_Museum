import { describe, it, expect, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { generateKeyPairSync } from 'node:crypto';
import { main, parseArgs, envSizeBytes, LAMBDA_ENV_LIMIT_BYTES } from '../tools/make-config.mjs';
import { hash, verify } from '../src/hashing.js';
import { authConfigProblem } from '../src/config.js';
import { normalizeAnswer } from '../src/normalize.js';

const fastHash = (s) => hash(s, { N: 16, r: 1, p: 1 });

/** Scripted answers for one clean run (username, password twice, 3 × prompt/answer/confirm). */
const BASIC = [
  '  Kelly ', 'Pass Word!', 'Pass Word!',
  'Where was our first brunch?', 'Short Stack!', 'y',
  "What is our dog's name?", 'Koda', '',
  'Where did we meet?', 'Madison', 'yes',
];

function run(lines, { argv = [], files = {}, demoPath = '/tmp/demo/auth-config.local.json' } = {}) {
  let transcript = '';
  const output = new Writable({
    write(chunk, _enc, cb) {
      transcript += chunk;
      cb();
    },
  });
  const fs = {
    readFileSync: vi.fn((p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    }),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
  const input = Readable.from([lines.map((l) => `${l}\n`).join('')]);
  const promise = main({ argv, input, output, fs, hashFn: fastHash, demoPath });
  return { promise, fs, transcript: () => transcript };
}

describe('make-config', () => {
  it('produces a valid Auth_Config whose hashes match the normalized username and answers and the exact password', async () => {
    const { promise } = run(BASIC);
    const cfg = await promise;
    expect(authConfigProblem(cfg)).toBeNull();
    expect(cfg.questions.map((q) => q.prompt)).toEqual(['Where was our first brunch?', "What is our dog's name?", 'Where did we meet?']);
    expect(await verify('kelly', cfg.usernameHash)).toBe(true);
    expect(await verify('Pass Word!', cfg.passwordHash)).toBe(true);
    expect(await verify('pass word!', cfg.passwordHash)).toBe(false);
    expect(await verify(normalizeAnswer('Short Stack!'), cfg.questions[0].answerHash)).toBe(true);
    expect(await verify('koda', cfg.questions[1].answerHash)).toBe(true);
    expect(await verify('madison', cfg.questions[2].answerHash)).toBe(true);
  });

  it('default (--print) prints the one-line AUTH_CONFIG and writes no files', async () => {
    const { promise, fs, transcript } = run(BASIC);
    const cfg = await promise;
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    const lines = transcript().split('\n');
    const at = lines.findIndex((l) => l.startsWith('AUTH_CONFIG'));
    expect(JSON.parse(lines[at + 1])).toEqual(cfg);
  });

  it('shows each normalized answer back, and never prints the password', async () => {
    const { promise, transcript } = run(BASIC);
    await promise;
    const text = transcript();
    expect(text).toContain('Will match: "short stack"');
    expect(text).toContain('Will match: "koda"');
    expect(text).toContain('Will match: "madison"');
    expect(text).not.toContain('Pass Word!');
    expect(text).not.toContain('Short Stack!');
  });

  it('--demo writes only the Demo_Config, owner-only, with hashes and no plaintext', async () => {
    const { promise, fs, transcript } = run(BASIC, { argv: ['--demo'] });
    const cfg = await promise;
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [path, data, opts] = fs.writeFileSync.mock.calls[0];
    expect(path).toBe('/tmp/demo/auth-config.local.json');
    expect(opts).toEqual({ mode: 0o600 });
    expect(JSON.parse(data)).toEqual(cfg);
    expect(data).not.toMatch(/Pass Word!|kelly|short stack|koda|madison/i);
    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/demo', { recursive: true });
    expect(transcript()).not.toContain('AUTH_CONFIG (paste');
  });

  it('retries a mismatched password, an empty answer, and a declined answer', async () => {
    const { promise, transcript } = run([
      '', 'Kelly',
      '', 'Pass Word!', 'oops', 'Pass Word!', 'Pass Word!',
      '', 'Where was our first brunch?', '!!!', 'shortstack', 'n', 'Short Stack', 'Y',
      "What is our dog's name?", 'Koda', 'y',
      'Where did we meet?', 'Madison', 'y',
    ]);
    const cfg = await promise;
    expect(await verify('short stack', cfg.questions[0].answerHash)).toBe(true);
    const text = transcript();
    expect(text).toContain('The username cannot be empty.');
    expect(text).toContain('The password cannot be empty.');
    expect(text).toContain('Those did not match.');
    expect(text).toContain('The question cannot be empty.');
    expect(text).toContain('no letters or digits left');
  });

  describe('--key', () => {
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });

    it('prints CLOUDFRONT_PRIVATE_KEY_B64 that decodes back to the PEM, and the size check passes', async () => {
      const { promise, transcript } = run(BASIC, { argv: ['--key', 'k.pem'], files: { 'k.pem': pem } });
      await promise;
      const lines = transcript().split('\n');
      const at = lines.findIndex((l) => l.startsWith('CLOUDFRONT_PRIVATE_KEY_B64'));
      expect(Buffer.from(lines[at + 1], 'base64').toString('utf8')).toBe(pem);
      expect(transcript()).toMatch(/total about \d+ of Lambda's 4096 bytes/);
      expect(transcript()).not.toContain('WARNING');
    });

    it('warns when long question texts would push the variables over 4 KB', async () => {
      const long = BASIC.slice();
      [3, 6, 9].forEach((i) => {
        long[i] = `${'A very long question that goes on and on '.repeat(15)}?`;
      });
      const { promise, transcript } = run(long, { argv: ['--key', 'k.pem'], files: { 'k.pem': pem } });
      await promise;
      expect(transcript()).toContain('WARNING: that is over the limit');
    });

    it('rejects a file that is not a private key, before asking anything', async () => {
      const { promise, transcript } = run([], { argv: ['--key', 'k.pem'], files: { 'k.pem': 'hello' } });
      await expect(promise).rejects.toThrow('not a PEM private key');
      expect(transcript()).not.toContain('Username');
    });

    it('rejects a non-RSA key', async () => {
      const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
      const { promise } = run([], { argv: ['--key', 'ec.pem'], files: { 'ec.pem': ec } });
      await expect(promise).rejects.toThrow('not an RSA key');
    });
  });

  it('fails clearly when the input ends early', async () => {
    const { promise } = run(['Kelly', 'Pass Word!']);
    await expect(promise).rejects.toThrow('input ended before setup finished');
  });

  it('prints usage and fails on an unknown option', async () => {
    const { promise, transcript } = run([], { argv: ['--nope'] });
    await expect(promise).rejects.toThrow('unknown option: --nope');
    expect(transcript()).toContain('Usage:');
  });

  it('parseArgs and envSizeBytes', () => {
    expect(parseArgs([])).toEqual({ demo: false, key: null, help: false, error: null });
    expect(parseArgs(['--demo', '--key', 'a.pem'])).toMatchObject({ demo: true, key: 'a.pem' });
    expect(parseArgs(['--key'])).toMatchObject({ error: '--key needs a file path' });
    expect(parseArgs(['-h']).help).toBe(true);
    expect(envSizeBytes({ AB: 'cd', E: 'é' })).toBe(2 + 2 + 1 + 2);
    expect(LAMBDA_ENV_LIMIT_BYTES).toBe(4096);
  });
});
