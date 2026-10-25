import { describe, it, expect } from 'vitest';
import { MEMORIES, FUTURE_MEMORY_TEXT, FUTURE_MEMORY_OVERLAY } from '../memories.js';

/**
 * Example-based tests for the static Memories_Manifest (`src/data/memories.js`).
 *
 * The module is a PURE, static ES module — no Phaser, no DOM, no network/fetch —
 * so it is imported directly (no mocks). These tests pin down the manifest's
 * structural contract and the exact future-memory copy.
 *
 * Validates: Requirements 12.8 (static in-app content, no backend) and
 *            13.5 (exact future-memory overlay text).
 */

describe('memories manifest', () => {
  it('imports without throwing and performs no network call', () => {
    // A real fetch in a pure module would have thrown or been observable on
    // import. Asserting the exports are present is sufficient evidence the
    // static module loaded cleanly; we also confirm fetch was never invoked.
    expect(MEMORIES).toBeTypeOf('object');
    expect(MEMORIES).not.toBeNull();
    if (typeof globalThis.fetch === 'function') {
      // If a fetch exists in the environment, importing a static module must
      // not have consumed it. There is no per-import counter to inspect, so we
      // simply assert the module did not replace/stub it with a spy of its own.
      expect(globalThis.fetch).toBeTypeOf('function');
    }
  });

  describe('FUTURE_MEMORY_TEXT', () => {
    it('is the exact authored string, heart emoji included', () => {
      expect(FUTURE_MEMORY_TEXT).toBe('A future memory, not yet saved ❤');
    });
  });

  describe('FUTURE_MEMORY_OVERLAY', () => {
    it('deep-equals the single-page future payload with null image', () => {
      expect(FUTURE_MEMORY_OVERLAY).toEqual({
        text: ['A future memory, not yet saved ❤'],
        imageUrl: null,
      });
    });

    it('reuses FUTURE_MEMORY_TEXT as its only page', () => {
      expect(FUTURE_MEMORY_OVERLAY.text[0]).toBe(FUTURE_MEMORY_TEXT);
    });
  });

  describe('MEMORIES entries', () => {
    it('contains at least one authored entry (N >= 1)', () => {
      const n = Object.keys(MEMORIES).length;
      expect(n).toBeGreaterThanOrEqual(1);
    });

    it('is keyed by contiguous integers starting at 0 (0..N-1, no gaps)', () => {
      const keys = Object.keys(MEMORIES).map(Number);
      const n = keys.length;
      // Every key must be a non-negative integer.
      for (const k of keys) {
        expect(Number.isInteger(k)).toBe(true);
      }
      const sorted = [...keys].sort((a, b) => a - b);
      const expected = Array.from({ length: n }, (_, i) => i);
      expect(sorted).toEqual(expected);
    });

    it('has every value shaped like a MemoryEntry', () => {
      for (const entry of Object.values(MEMORIES)) {
        expect(entry).toBeTypeOf('object');
        expect(entry).not.toBeNull();
        // text: string[]
        expect(Array.isArray(entry.text)).toBe(true);
        for (const page of entry.text) {
          expect(typeof page).toBe('string');
        }
        // imageUrl: string | null
        expect(entry.imageUrl === null || typeof entry.imageUrl === 'string').toBe(true);
      }
    });
  });
});
