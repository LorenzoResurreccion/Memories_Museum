import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { checkAll, checkAnswers, checkCredentials } from '../src/checks.js';
import { hash, verify } from '../src/hashing.js';
import { normalizeAnswer, normalizeUsername } from '../src/normalize.js';

/** Low scrypt cost so every run can build a fresh config. */
const FAST = { N: 16, r: 1, p: 1 };

const wordArb = fc.stringMatching(/^[a-z0-9]{1,8}$/);
/** A canonical answer: 1–3 lowercase words joined by single spaces (already normalized). */
const answerArb = fc.array(wordArb, { minLength: 1, maxLength: 3 }).map((w) => w.join(' '));

/** Turn a canonical answer into a messy spelling that must still match. */
const messyArb = (canonical) =>
  fc
    .record({
      upper: fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
      lead: fc.constantFrom('', ' ', '  ', '\t'),
      trail: fc.constantFrom('', ' ', '!', '!!', '.', '?'),
      gap: fc.constantFrom(' ', '  ', ' \t '),
    })
    .map(({ upper, lead, trail, gap }) => {
      let i = 0;
      const recased = [...canonical].map((c) => (upper[i++ % upper.length] ? c.toUpperCase() : c)).join('');
      return lead + recased.split(' ').join(gap) + trail;
    });

async function makeConfig(username, password, answers) {
  return {
    version: 1,
    usernameHash: await hash(normalizeUsername(username), FAST),
    passwordHash: await hash(password, FAST),
    questions: await Promise.all(
      answers.map(async (a, i) => ({ prompt: `Question ${i + 1}`, answerHash: await hash(normalizeAnswer(a), FAST) })),
    ),
  };
}

/** A verify spy that counts every comparison. */
function countingVerify() {
  return vi.fn((input, stored) => verify(input, stored));
}

describe('checks (property tests)', () => {
  // Feature: museum-login, Property 3: All-or-nothing answer check
  // **Validates: Requirements 4.1, 4.5**
  it('Property 3a: checkAnswers is true iff every answer normalizes to its own question\'s accepted answer', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(answerArb, { minLength: 3, maxLength: 3 }),
        fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
        fc.array(answerArb, { minLength: 3, maxLength: 3 }),
        fc.nat(),
        async (accepted, useRight, wrongPool, seed) => {
          const config = await makeConfig('kelly', 'pw', accepted);
          const submitted = await Promise.all(
            accepted.map(async (a, i) => {
              if (useRight[i]) return fc.sample(messyArb(a), { numRuns: 1, seed: seed + i })[0];
              return wrongPool[i];
            }),
          );
          // A "wrong" answer that happens to equal the accepted one is really right.
          const expected = submitted.every((s, i) => normalizeAnswer(s) === accepted[i]);
          expect(await checkAnswers(config, submitted)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 3b: changing any single answer to a different value makes it false', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(answerArb, { minLength: 3, maxLength: 3 }),
        fc.integer({ min: 0, max: 2 }),
        answerArb,
        async (accepted, which, replacement) => {
          fc.pre(replacement !== accepted[which]);
          const config = await makeConfig('kelly', 'pw', accepted);
          expect(await checkAnswers(config, accepted)).toBe(true);
          const changed = accepted.slice();
          changed[which] = replacement;
          expect(await checkAnswers(config, changed)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 3c: answers moved to the wrong question fail unless the accepted answers are equal', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(answerArb, { minLength: 3, maxLength: 3 }),
        fc.constantFrom([1, 0, 2], [0, 2, 1], [2, 1, 0], [1, 2, 0], [2, 0, 1]),
        async (accepted, perm) => {
          const config = await makeConfig('kelly', 'pw', accepted);
          const permuted = perm.map((j) => accepted[j]);
          const expected = permuted.every((a, i) => a === accepted[i]);
          expect(await checkAnswers(config, permuted)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 3d: checkAll needs the username, the exact password and all three answers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(answerArb, { minLength: 3, maxLength: 3 }),
        fc.constantFrom('username', 'password', 'answer', 'none'),
        async (accepted, broken) => {
          const config = await makeConfig('Kelly', 'Pass Word!', accepted);
          const attempt = { username: '  KELLY ', password: 'Pass Word!', answers: accepted.slice() };
          if (broken === 'username') attempt.username = 'kelly2';
          if (broken === 'password') attempt.password = 'pass word!'; // passwords are case-sensitive
          if (broken === 'answer') attempt.answers[1] = `${accepted[1]}x`;
          expect(await checkAll(config, attempt)).toBe(broken === 'none');
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: museum-login, Property 4: Every comparison runs
  // **Validates: Requirement 4.6**
  it('Property 4: finish always makes exactly 5 comparisons, whatever fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(answerArb, { minLength: 3, maxLength: 3 }),
        fc.record({
          username: fc.oneof(fc.constant('kelly'), fc.string({ maxLength: 10 })),
          password: fc.oneof(fc.constant('pw'), fc.string({ maxLength: 10 })),
          answers: fc.oneof(
            fc.array(fc.string({ maxLength: 10 }), { minLength: 0, maxLength: 5 }),
            fc.constant(undefined),
            fc.constant('not an array'),
          ),
        }),
        async (accepted, attempt) => {
          const config = await makeConfig('kelly', 'pw', accepted);
          const verifyFn = countingVerify();
          await checkAll(config, attempt, { verifyFn });
          expect(verifyFn).toHaveBeenCalledTimes(5);

          const credentialsOnly = countingVerify();
          await checkCredentials(config, attempt.username, attempt.password, { verifyFn: credentialsOnly });
          expect(credentialsOnly).toHaveBeenCalledTimes(2);

          const answersOnly = countingVerify();
          await checkAnswers(config, attempt.answers, { verifyFn: answersOnly });
          expect(answersOnly).toHaveBeenCalledTimes(3);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('the first failing comparison never short-circuits the rest', async () => {
    const config = await makeConfig('kelly', 'pw', ['a', 'b', 'c']);
    const seen = [];
    const verifyFn = vi.fn(async (input, stored) => {
      seen.push(stored);
      return false;
    });
    expect(await checkAll(config, { username: 'kelly', password: 'pw', answers: ['a', 'b', 'c'] }, { verifyFn })).toBe(false);
    expect(new Set(seen)).toEqual(
      new Set([config.usernameHash, config.passwordHash, ...config.questions.map((q) => q.answerHash)]),
    );
  });
});
