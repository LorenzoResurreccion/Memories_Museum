import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { hash, verify, parseHash, SCRYPT_DEFAULTS } from '../src/hashing.js';

/** Low cost so 100+ runs stay fast. Real cost is covered by one example test below. */
const FAST = { N: 16, r: 1, p: 1 };

describe('hashing (property tests)', () => {
  // Feature: museum-login, Property 2: Hash round-trip
  // **Validates: Requirement 4.4**
  it('Property 2a: verify(x, hash(x)) is true', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: 'binary', maxLength: 40 }), async (x) => {
        expect(await verify(x, await hash(x, FAST))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 2b: verify(y, hash(x)) is false for y !== x', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: 'binary', maxLength: 40 }),
        fc.string({ unit: 'binary', maxLength: 40 }),
        async (x, y) => {
          fc.pre(x !== y);
          expect(await verify(y, await hash(x, FAST))).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 2c: two hashes of the same input differ but both verify', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 30 }), async (x) => {
        const [a, b] = await Promise.all([hash(x, FAST), hash(x, FAST)]);
        expect(a).not.toBe(b);
        expect(await verify(x, a)).toBe(true);
        expect(await verify(x, b)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('a tampered key or salt never verifies', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 30 }), fc.integer({ min: 4, max: 5 }), fc.nat(), async (x, part, pos) => {
        const parts = (await hash(x, FAST)).split('$');
        const bytes = Buffer.from(parts[part], 'base64');
        bytes[pos % bytes.length] ^= 0x01;
        parts[part] = bytes.toString('base64');
        expect(await verify(x, parts.join('$'))).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('malformed stored hashes are rejected without throwing', async () => {
    const bad = [
      '', 'nope', 'scrypt$16$1$1$AAAA', 'bcrypt$16$1$1$AAAA$BBBB',
      'scrypt$15$1$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==', // N not a power of two
      `scrypt$${2 ** 21}$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==`, // N above the limit
      'scrypt$16$0$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==', // r = 0
      'scrypt$16$1$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA', // key too short
      null, undefined, 42,
    ];
    for (const stored of bad) {
      expect(parseHash(stored)).toBeNull();
      await expect(verify('x', stored)).resolves.toBe(false);
    }
    await expect(verify(undefined, await hash('x', FAST))).resolves.toBe(false);
  });

  it('stores its parameters and rejects non-string input', async () => {
    const stored = await hash('x', FAST);
    expect(stored).toMatch(/^scrypt\$16\$1\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(parseHash(stored)).toMatchObject({ N: 16, r: 1, p: 1 });
    await expect(hash(42)).rejects.toThrow(TypeError);
  });

  it('round-trips at the real production cost', async () => {
    const stored = await hash('short stack');
    expect(parseHash(stored)).toMatchObject({ N: SCRYPT_DEFAULTS.N, r: SCRYPT_DEFAULTS.r, p: SCRYPT_DEFAULTS.p });
    expect(await verify('short stack', stored)).toBe(true);
    expect(await verify('short stacks', stored)).toBe(false);
  }, 30000);
});
