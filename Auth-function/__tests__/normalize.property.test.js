import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizeAnswer, normalizeUsername } from '../src/normalize.js';

/** A word of ASCII letters and digits (case transforms are well defined for these). */
const wordArb = fc.stringMatching(/^[A-Za-z0-9]{1,10}$/);
const wordsArb = fc.array(wordArb, { minLength: 1, maxLength: 6 });
const punctArb = fc.constantFrom(...'!?.,;:\'"()-_*&#@/\\[]{}~`^%$+='.split(''));
const spaceArb = fc.constantFrom(' ', '  ', '\t', '\n', ' \t ', '\u00a0');

describe('normalize (property tests)', () => {
  // Feature: museum-login, Property 1: Normalization is idempotent and ignores case, punctuation and spacing
  // **Validates: Requirements 4.1, 4.2**
  it('Property 1a: normalizeAnswer is idempotent for any string', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (s) => {
        const once = normalizeAnswer(s);
        expect(normalizeAnswer(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  it('Property 1b: the result never has leading, trailing or doubled spaces', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (s) => {
        const out = normalizeAnswer(s);
        expect(out).toBe(out.trim());
        expect(out).not.toMatch(/\s{2,}/u);
        expect(out).not.toMatch(/[^\S ]/u); // only plain spaces remain
      }),
      { numRuns: 500 },
    );
  });

  it('Property 1c: changing case, punctuation and spacing between words never changes the result', () => {
    fc.assert(
      fc.property(
        wordsArb,
        fc.array(fc.boolean(), { minLength: 60, maxLength: 60 }),
        fc.array(fc.array(punctArb, { maxLength: 2 }), { minLength: 7, maxLength: 7 }),
        fc.array(spaceArb, { minLength: 7, maxLength: 7 }),
        (words, upper, puncts, spaces) => {
          const canonical = words.join(' ');
          let k = 0;
          const recase = (w) => [...w].map((c) => (upper[k++ % upper.length] ? c.toUpperCase() : c.toLowerCase())).join('');
          // Punctuation hugs words; spacing sits between them, plus around the ends.
          const messy =
            spaces[0] +
            words.map((w, i) => puncts[i].join('') + recase(w) + puncts[i].slice().reverse().join('')).join(spaces[1]) +
            spaces[2];
          expect(normalizeAnswer(messy)).toBe(normalizeAnswer(canonical));
          expect(normalizeAnswer(canonical)).toBe(canonical.toLowerCase());
        },
      ),
      { numRuns: 300 },
    );
  });

  it('normalizeUsername trims and lowercases only', () => {
    fc.assert(
      fc.property(wordArb, spaceArb, spaceArb, (w, a, b) => {
        expect(normalizeUsername(a + w + b)).toBe(w.toLowerCase());
      }),
      { numRuns: 200 },
    );
  });

  it('examples', () => {
    expect(normalizeAnswer('  Short   Stack!! ')).toBe('short stack');
    expect(normalizeAnswer('short-stack')).toBe('shortstack');
    expect(normalizeAnswer('Café #3')).toBe('café 3');
    expect(normalizeAnswer('ＫＥＬＬＹ')).toBe('kelly'); // full-width letters fold via NFKC
    expect(normalizeAnswer(undefined)).toBe('');
    expect(normalizeUsername(42)).toBe('');
  });
});
