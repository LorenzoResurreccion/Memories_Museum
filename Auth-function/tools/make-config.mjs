#!/usr/bin/env node
/**
 * make-config.mjs — set the museum login's username, password and three questions.
 *
 *   node tools/make-config.mjs            print AUTH_CONFIG to paste into the Lambda console
 *   node tools/make-config.mjs --demo     write the git-ignored Demo_Config for npm run dev:auth
 *   node tools/make-config.mjs --key k.pem  also print CLOUDFRONT_PRIVATE_KEY_B64 + size check
 *
 * Secrets are typed with hidden input. Each answer's normalized form is shown back so you
 * can see exactly what will be matched (case, spacing and punctuation are ignored). Only
 * salted hashes are output; the plaintext password and answers are never written anywhere.
 * Requirements: 9.2, 9.3, 9.4, 9.7.
 */

import { createInterface } from 'node:readline';
import { createPrivateKey } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash as defaultHash } from '../src/hashing.js';
import { normalizeAnswer, normalizeUsername } from '../src/normalize.js';
import { authConfigProblem } from '../src/config.js';

/** Where `--demo` writes the Demo_Config (git-ignored). */
export const DEMO_CONFIG_PATH = fileURLToPath(new URL('../demo/auth-config.local.json', import.meta.url));

/** Lambda's limit on all environment variable names + values together. */
export const LAMBDA_ENV_LIMIT_BYTES = 4096;

/** Typical sizes of the two non-secret variables, for the size estimate. */
const TYPICAL_KEY_PAIR_ID = 'K2JCJMDEHXQW5F';
const TYPICAL_APP_DOMAIN = 'd1234567890abc.cloudfront.net';

const USAGE = `Usage: node tools/make-config.mjs [--demo] [--key <private key .pem>]

  (default)   print the AUTH_CONFIG value to paste into the Lambda console
  --demo      write it to demo/auth-config.local.json for npm run dev:auth instead
  --key FILE  also print CLOUDFRONT_PRIVATE_KEY_B64 for that key and check the 4 KB limit
`;

/**
 * Total bytes of the Lambda environment variables (names + values).
 * @param {Record<string,string>} vars
 */
export function envSizeBytes(vars) {
  return Object.entries(vars).reduce((sum, [k, v]) => sum + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = { demo: false, key: null, help: false, error: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--demo') args.demo = true;
    else if (a === '--print') args.demo = false;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--key') {
      args.key = argv[i + 1] ?? null;
      i += 1;
      if (!args.key) args.error = '--key needs a file path';
    } else args.error = `unknown option: ${a}`;
  }
  return args;
}

/**
 * Line-based prompter. Uses the async line iterator so piped (scripted) input is never
 * dropped. In a real terminal, hidden prompts suppress the typed characters.
 */
function createPrompter(input, output) {
  const terminal = Boolean(input.isTTY && output.isTTY);
  const rl = createInterface({ input, output, terminal });
  const lines = rl[Symbol.asyncIterator]();
  let hidden = false;
  if (terminal) {
    const write = rl._writeToOutput?.bind(rl);
    if (write) {
      rl._writeToOutput = (text) => {
        if (!hidden || text.includes('\n') || text.includes('\r')) write(hidden ? '\n' : text);
      };
    }
  }
  return {
    async ask(question, { secret = false } = {}) {
      output.write(question);
      hidden = secret;
      const { value, done } = await lines.next();
      hidden = false;
      if (done) throw new Error('input ended before setup finished');
      if (secret && !terminal) output.write('\n');
      return value;
    },
    close: () => rl.close(),
  };
}

/**
 * Run the setup. Returns the Auth_Config it produced.
 *
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 * @param {Pick<typeof nodeFs, 'readFileSync'|'writeFileSync'|'mkdirSync'>} [options.fs]
 * @param {(input:string) => Promise<string>} [options.hashFn]
 * @param {string} [options.demoPath]
 */
export async function main({
  argv = process.argv.slice(2),
  input = process.stdin,
  output = process.stdout,
  fs = nodeFs,
  hashFn = defaultHash,
  demoPath = DEMO_CONFIG_PATH,
} = {}) {
  const args = parseArgs(argv);
  if (args.help || args.error) {
    if (args.error) output.write(`${args.error}\n\n`);
    output.write(USAGE);
    if (args.error) throw new Error(args.error);
    return null;
  }

  // Validate the key before asking anything, so a bad path fails fast.
  let keyB64 = null;
  if (args.key) {
    const pem = fs.readFileSync(args.key, 'utf8');
    let key;
    try {
      key = createPrivateKey(pem);
    } catch {
      throw new Error(`${args.key} is not a PEM private key`);
    }
    if (key.asymmetricKeyType !== 'rsa') throw new Error(`${args.key} is not an RSA key (CloudFront needs RSA)`);
    keyB64 = Buffer.from(pem, 'utf8').toString('base64');
  }

  const prompt = createPrompter(input, output);
  try {
    output.write('Museum login setup. Secrets are hidden as you type.\n\n');

    let username = '';
    while (username === '') {
      username = normalizeUsername(await prompt.ask('Username: '));
      if (username === '') output.write('  The username cannot be empty.\n');
    }
    output.write(`  Usernames ignore case and surrounding spaces; she can type "${username}" any way.\n`);

    let password = '';
    for (;;) {
      password = await prompt.ask('Password: ', { secret: true });
      if (password === '') {
        output.write('  The password cannot be empty.\n');
        continue;
      }
      const again = await prompt.ask('Password again: ', { secret: true });
      if (again === password) break;
      output.write('  Those did not match. Try again.\n');
    }
    output.write('  Passwords are matched exactly, including case.\n\n');

    const questions = [];
    for (let i = 1; i <= 3; i += 1) {
      let promptText = '';
      while (promptText === '') {
        promptText = (await prompt.ask(`Question ${i}: `)).trim();
        if (promptText === '') output.write('  The question cannot be empty.\n');
      }
      let normalized = '';
      for (;;) {
        normalized = normalizeAnswer(await prompt.ask(`Answer to question ${i}: `, { secret: true }));
        if (normalized === '') {
          output.write('  That answer has no letters or digits left after normalizing. Try again.\n');
          continue;
        }
        output.write(`  Will match: "${normalized}" (case, spacing and punctuation ignored)\n`);
        const ok = (await prompt.ask('  Use this answer? [Y/n] ')).trim().toLowerCase();
        if (ok === '' || ok === 'y' || ok === 'yes') break;
      }
      questions.push({ prompt: promptText, answer: normalized });
      output.write('\n');
    }

    output.write('Hashing (a few seconds)...\n');
    const authConfig = {
      version: 1,
      usernameHash: await hashFn(username),
      passwordHash: await hashFn(password),
      questions: await Promise.all(questions.map(async (q) => ({ prompt: q.prompt, answerHash: await hashFn(q.answer) }))),
    };
    const problem = authConfigProblem(authConfig);
    if (problem) throw new Error(`generated config ${problem}`);
    const json = JSON.stringify(authConfig);

    if (args.demo) {
      fs.mkdirSync(dirname(demoPath), { recursive: true });
      fs.writeFileSync(demoPath, `${json}\n`, { mode: 0o600 });
      output.write(`\nWrote the demo login to ${demoPath}\nStart the demo with: npm run dev:auth (in Front-end/)\n`);
    } else {
      output.write('\nAUTH_CONFIG (paste this whole line as the value):\n');
      output.write(`${json}\n`);
    }

    if (keyB64) {
      if (!args.demo) {
        output.write('\nCLOUDFRONT_PRIVATE_KEY_B64 (paste this whole line as the value):\n');
        output.write(`${keyB64}\n`);
      }
      const size = envSizeBytes({
        AUTH_CONFIG: json,
        CLOUDFRONT_PRIVATE_KEY_B64: keyB64,
        CLOUDFRONT_KEY_PAIR_ID: TYPICAL_KEY_PAIR_ID,
        APP_DOMAIN: TYPICAL_APP_DOMAIN,
      });
      output.write(`\nEnvironment variables total about ${size} of Lambda's ${LAMBDA_ENV_LIMIT_BYTES} bytes.\n`);
      if (size > LAMBDA_ENV_LIMIT_BYTES) {
        output.write('WARNING: that is over the limit. Shorten the question texts and run this again.\n');
      }
    }
    return authConfig;
  } finally {
    prompt.close();
  }
}

// Run when called directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === nodeFs.realpathSync(process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(`\n${err.message}\n`);
    process.exit(1);
  });
}
