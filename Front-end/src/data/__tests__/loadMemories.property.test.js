import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseDialogue, fetchMemoryEntries } from '../loadMemories.js';

/** Page text: trimmed, non-empty, and no line that is only `---`. */
const pageArb = fc
  .array(
    fc.stringMatching(/^[A-Za-z0-9 !?.,'()-]{1,40}$/).filter((line) => !/^\s*---\s*$/.test(line)),
    { minLength: 1, maxLength: 3 },
  )
  .map((lines) => lines.join('\n').trim())
  .filter((page) => page.length > 0);

/** Separator variants that parseDialogue must accept. */
const sepArb = fc.constantFrom('\n---\n', '\r\n---\r\n', '\n  ---\t\n', '\n\n---\n\n');

describe('loadMemories (property tests)', () => {
  // Feature: runtime-dialogue, Property 1: pages joined by separators parse back to the same pages
  it('Property 1: parseDialogue round-trips pages joined by --- separators', () => {
    fc.assert(
      fc.property(fc.array(pageArb, { minLength: 1, maxLength: 12 }), fc.array(sepArb, { minLength: 11, maxLength: 11 }), (pages, seps) => {
        const md = pages.reduce((acc, page, i) => (i === 0 ? page : acc + seps[i - 1] + page), '');
        const expected = pages.map((p) => p.replace(/\r\n?/g, '\n').trim());
        expect(parseDialogue(md)).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: runtime-dialogue, Property 2: parsed pages are never empty and never untrimmed
  it('Property 2: parseDialogue output pages are trimmed and non-empty for any input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (md) => {
        for (const page of parseDialogue(md)) {
          expect(page.length).toBeGreaterThan(0);
          expect(page).toBe(page.trim());
        }
      }),
      { numRuns: 300 },
    );
  });

  // Feature: runtime-dialogue, Property 3: N is the first missing index
  it('Property 3: N equals the first missing index, for any present set and batch size', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.nat({ max: 40 }), { maxLength: 40 }),
        fc.integer({ min: 1, max: 10 }),
        async (present, batchSize) => {
          const set = new Set(present);
          const fetchImpl = async (url) => {
            const i = Number(/(\d+)\.md$/.exec(url)[1]);
            return set.has(i)
              ? { ok: true, headers: new Map(), text: async () => `page ${i}` }
              : { ok: false, headers: new Map(), text: async () => '' };
          };
          let firstMissing = 0;
          while (set.has(firstMissing)) firstMissing += 1;

          const entries = await fetchMemoryEntries({ fetchImpl, batchSize, maxCount: 100 });
          const keys = Object.keys(entries).map(Number);
          expect(keys).toEqual(Array.from({ length: firstMissing }, (_, i) => i));
          for (const k of keys) expect(entries[k].text).toEqual([`page ${k}`]);
        },
      ),
      { numRuns: 150 },
    );
  });
});
