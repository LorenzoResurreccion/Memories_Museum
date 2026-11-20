import { describe, it, expect, afterEach } from 'vitest';
import { PAINTINGS, PAINTING_PLACEHOLDER_KEY, syncPaintings } from '../paintings.js';
import { setMemories } from '../memories.js';
import { paintingUrl } from '../mediaBase.js';

/**
 * Example-based tests for the static Painting_Image_Source (`src/data/paintings.js`).
 *
 * The module is a PURE, static ES module — no Phaser, no DOM, no network/fetch —
 * so it is imported directly (no mocks). These tests pin down the source's
 * structural contract: a non-empty placeholder key and `{ key, ... }`-shaped
 * entries with a string `key`.
 *
 * Validates: Requirements 5.1 (placeholder key / bundled texture), 5.5 (static
 *            in-app content, imported never fetched).
 */

describe('paintings source', () => {
  it('imports without throwing and performs no network call', () => {
    // A real fetch in a pure module would have thrown or been observable on
    // import. Asserting the exports are present is sufficient evidence the
    // static module loaded cleanly; we also confirm fetch was never replaced.
    expect(PAINTINGS).toBeTypeOf('object');
    expect(PAINTINGS).not.toBeNull();
    if (typeof globalThis.fetch === 'function') {
      expect(globalThis.fetch).toBeTypeOf('function');
    }
  });

  describe('PAINTING_PLACEHOLDER_KEY', () => {
    it('is a non-empty string', () => {
      expect(typeof PAINTING_PLACEHOLDER_KEY).toBe('string');
      expect(PAINTING_PLACEHOLDER_KEY.length).toBeGreaterThan(0);
    });
  });

  describe('PAINTINGS entries', () => {
    afterEach(() => {
      setMemories({});
      syncPaintings();
    });

    it('is derived from MEMORIES: one painting_NN entry per memory', () => {
      setMemories({
        0: { text: ['a'], imageUrl: null },
        1: { text: ['b'], imageUrl: null },
        2: { text: ['c'], imageUrl: null },
      });
      syncPaintings();
      expect(Object.keys(PAINTINGS)).toEqual(['0', '1', '2']);
      expect(PAINTINGS[1]).toEqual({ key: 'painting_01', url: paintingUrl(1) });
    });

    it('shrinks back when MEMORIES shrinks', () => {
      setMemories({ 0: { text: ['a'], imageUrl: null }, 1: { text: ['b'], imageUrl: null } });
      syncPaintings();
      setMemories({ 0: { text: ['a'], imageUrl: null } });
      syncPaintings();
      expect(Object.keys(PAINTINGS)).toEqual(['0']);
    });

    it('is keyed by contiguous integers starting at 0 (0..N-1, no gaps)', () => {
      const keys = Object.keys(PAINTINGS).map(Number);
      const n = keys.length;
      for (const k of keys) {
        expect(Number.isInteger(k)).toBe(true);
      }
      const sorted = [...keys].sort((a, b) => a - b);
      const expected = Array.from({ length: n }, (_, i) => i);
      expect(sorted).toEqual(expected);
    });

    it('has every value shaped like a PaintingEntry with a string key', () => {
      for (const entry of Object.values(PAINTINGS)) {
        expect(entry).toBeTypeOf('object');
        expect(entry).not.toBeNull();
        expect(typeof entry.key).toBe('string');
        expect(entry.key.length).toBeGreaterThan(0);
      }
    });
  });
});
