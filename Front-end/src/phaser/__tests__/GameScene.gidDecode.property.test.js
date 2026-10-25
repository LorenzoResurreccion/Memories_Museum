import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Feature: infinite-hallway, SUPPORTING property test (not one of the 18 numbered
// correctness properties): gidDecode totality & consistency.
//
// `gidDecode` decodes a Tiled global tile id (GID) into a masked frame plus the
// three flip flags. This test asserts the decode is TOTAL (never throws for any
// integer GID) and CONSISTENT with the raw bit layout:
//   frame === (gid & 0x1FFFFFFF)
//   flipH === (gid & 0x80000000) !== 0
//   flipV === (gid & 0x40000000) !== 0
//   flipD === (gid & 0x20000000) !== 0
// Requirements: 7.1, 7.2
//
// GameScene.js imports Phaser (and extends Phaser.Scene) at module level; mock it
// before importing the helper, matching the existing __tests__ pattern.
vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config?.key;
    }
  }
}));

import { gidDecode } from '../GameScene.js';

const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;
const FRAME_MASK = 0x1fffffff;

describe('gidDecode (supporting property: totality & consistency)', () => {
  /**
   * Over random GIDs (a base frame id OR'd with a random subset of the three
   * Tiled flip bits), the decode never throws and each field matches the raw
   * bit expression computed directly from the gid.
   * **Validates: Requirements 7.1, 7.2**
   */
  it('decodes any flagged GID totally and consistently with the raw bit layout', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: FRAME_MASK }),
        fc.subarray([FLIP_H, FLIP_V, FLIP_D]),
        (baseId, flipBits) => {
          // OR the base id with a random subset of flip bits.
          const gid = flipBits.reduce((acc, bit) => acc | bit, baseId);

          let result;
          expect(() => {
            result = gidDecode(gid);
          }).not.toThrow();

          expect(result.frame).toBe(gid & FRAME_MASK);
          expect(result.flipH).toBe((gid & FLIP_H) !== 0);
          expect(result.flipV).toBe((gid & FLIP_V) !== 0);
          expect(result.flipD).toBe((gid & FLIP_D) !== 0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Over plain ids with no flip flags set, all three flip flags are false and
   * the frame equals the gid unchanged.
   * **Validates: Requirements 7.1, 7.2**
   */
  it('decodes plain ids (no flip bits) to frame === gid and all flips false', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: FRAME_MASK }), (id) => {
        const result = gidDecode(id);
        expect(result.frame).toBe(id);
        expect(result.flipH).toBe(false);
        expect(result.flipV).toBe(false);
        expect(result.flipD).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
