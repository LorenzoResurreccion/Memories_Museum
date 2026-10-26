import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Feature: wall-paintings, Property 5: Painting determinism on return
// **Validates: Requirements 3.4**
//
// Feature: wall-paintings, Property 6: Future painting placeholder
// **Validates: Requirements 3.5**
//
// `resolvePaintingImage(segIndex, paintingIndex, source, N)` is a PURE resolver:
// it derives `memoryIndex = segIndex*6 + paintingIndex` and returns the texture
// key to render — the authored PAINTINGS entry's key below N (falling back to the
// placeholder when the entry/key is missing), or `PAINTING_PLACEHOLDER_KEY` for a
// Future_Painting (>= N). The helper imports only the static source module (no
// Phaser), so no module mock is required.
import { resolvePaintingImage } from '../paintingResolve.js';
import { PAINTING_PLACEHOLDER_KEY } from '../../data/paintings.js';

const segArb = fc.nat({ max: 10000 });
const paintingArb = fc.integer({ min: 0, max: 5 });
const nArb = fc.nat({ max: 60 });

/**
 * Build a synthetic PAINTINGS-shaped source with `n` contiguous authored entries
 * at indices `0..n-1`, each with a deterministic non-placeholder key so the
 * authored branch is distinguishable from the placeholder fallback.
 * @param {number} n
 * @returns {Record<number, {key: string, url: string|null}>}
 */
function syntheticSource(n) {
  const src = {};
  for (let i = 0; i < n; i += 1) {
    src[i] = { key: `painting_${i}`, url: null };
  }
  return src;
}

describe('resolvePaintingImage', () => {
  /**
   * Property 5: Painting determinism on return — re-resolving the same
   * `(segIndex, paintingIndex, source, N)` yields the identical key (and whole
   * result), so re-entering a Segment_Index renders the same painting.
   * **Validates: Requirements 3.4**
   */
  it('Property 5: is deterministic — two resolves of the same inputs deeply equal', () => {
    fc.assert(
      fc.property(segArb, paintingArb, nArb, (s, p, n) => {
        const source = syntheticSource(n);
        const first = resolvePaintingImage(s, p, source, n);
        const second = resolvePaintingImage(s, p, source, n);
        expect(second.key).toBe(first.key);
        expect(second.memoryIndex).toBe(first.memoryIndex);
        expect(second.isPlaceholder).toBe(first.isPlaceholder);
        expect(second).toEqual(first);
        // memoryIndex is the pure arithmetic function of (s, p).
        expect(first.memoryIndex).toBe(s * 6 + p);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Future painting placeholder — for all inputs whose
   * `memoryIndex >= N`, the resolved key is `PAINTING_PLACEHOLDER_KEY` and
   * `isPlaceholder === true`.
   * **Validates: Requirements 3.5**
   */
  it('Property 6: resolves memoryIndex >= N to the placeholder key', () => {
    fc.assert(
      fc.property(segArb, paintingArb, nArb, (s, p, n) => {
        const source = syntheticSource(n);
        const result = resolvePaintingImage(s, p, source, n);
        if (result.memoryIndex >= n) {
          expect(result.key).toBe(PAINTING_PLACEHOLDER_KEY);
          expect(result.isPlaceholder).toBe(true);
        } else {
          // Below N the synthetic authored key is used (not the placeholder).
          expect(result.key).toBe(`painting_${result.memoryIndex}`);
          expect(result.isPlaceholder).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});
