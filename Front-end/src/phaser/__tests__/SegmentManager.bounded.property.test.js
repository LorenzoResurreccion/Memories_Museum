// Feature: infinite-hallway, Property 5: Bounded generation
// **Validates: Requirements 3.3, 4.7, 13.1**
//
// Generation is bounded on the right at Final_Segment_Index = floor((N-1)/6) for
// N >= 1, else 0. No matter how far right the player is driven, SegmentManager never
// generates a segment index greater than finalSegmentIndex, and segmentCount never
// exceeds finalSegmentIndex + 1.
//
// SegmentManager imports no Phaser; builders are inert stubs that always succeed, so
// the only thing stopping rightward growth is the bound itself.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import SegmentManager from '../SegmentManager.js';

const SEGMENT_WIDTH = 58 * 16; // 928

/** finalSegmentIndex derived from N exactly as the manager derives it (Req 13.2). */
function finalIndexForN(n) {
  return n >= 1 ? Math.floor((n - 1) / 6) : 0;
}

describe('SegmentManager — Property 5: bounded generation', () => {
  /**
   * For random authoredMemoryCount N, driving the player arbitrarily far right never
   * generates an index > finalSegmentIndex and keeps segmentCount <= finalSegmentIndex + 1.
   * Every index held in the loaded window is likewise within [0, finalSegmentIndex].
   * **Validates: Requirements 3.3, 4.7, 13.1**
   */
  it('never generates past finalSegmentIndex however far right the player goes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 }), // authoredMemoryCount N
        // A monotonically-advancing rightward drive: cumulative positive steps.
        fc.array(fc.integer({ min: 0, max: 4000 }), { minLength: 1, maxLength: 80 }),
        (n, steps) => {
          const finalSegmentIndex = finalIndexForN(n);
          const mgr = new SegmentManager({
            startRightEdgeX: 0,
            segmentWidthPx: SEGMENT_WIDTH,
            authoredMemoryCount: n,
            maxLoaded: 3,
            generateAheadPx: SEGMENT_WIDTH,
            buildSegment: (index, worldOffsetX) => ({ index, worldOffsetX }),
            releaseSegment: () => {}
          });

          expect(mgr.finalSegmentIndex).toBe(finalSegmentIndex);

          let x = 0;
          for (const step of steps) {
            x += step; // only ever moves right
            mgr.update(x);

            // Count bound (Req 4.7).
            expect(mgr.segmentCount).toBeLessThanOrEqual(finalSegmentIndex + 1);

            // No loaded index exceeds the bound or drops below 0 (Req 3.3, 13.1).
            for (const idx of mgr.loadedWindow.keys()) {
              expect(idx).toBeGreaterThanOrEqual(0);
              expect(idx).toBeLessThanOrEqual(finalSegmentIndex);
            }
          }

          // After an extreme rightward push, the rightmost generated index is exactly
          // the bound (fully explored), and count is capped.
          mgr.update(Number.MAX_SAFE_INTEGER / 2);
          expect(mgr.segmentCount).toBe(finalSegmentIndex + 1);
          expect(mgr.segmentCount).toBeLessThanOrEqual(finalSegmentIndex + 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
