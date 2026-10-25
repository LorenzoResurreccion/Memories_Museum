// Feature: infinite-hallway, Property 2: Floor continuity
// **Validates: Requirements 3.1, 3.5, 5.2**
//
// Adjacent Hallway_Segments stitch flush with the start map and with each other:
// segment index 0's left edge equals the start-map floor right edge (startRightEdgeX),
// and every segment index n (n >= 1) begins exactly where index n-1 ends — zero gap,
// zero overlap. Because all segments share the same map height, the floor Y is
// identical across segments, so the floor is continuous.
//
// SegmentManager.worldOffsetForIndex is pure arithmetic and imports no Phaser, so the
// manager is constructed directly with inert builder stubs.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import SegmentManager from '../SegmentManager.js';

const SEGMENT_WIDTH = 58 * 16; // 928

/** Build a manager whose offsets we can probe; builders are inert for pure math. */
function makeManager(startRightEdgeX, finalSegmentIndex) {
  return new SegmentManager({
    startRightEdgeX,
    segmentWidthPx: SEGMENT_WIDTH,
    finalSegmentIndex,
    buildSegment: (index, worldOffsetX) => ({ index, worldOffsetX }),
    releaseSegment: () => {}
  });
}

describe('SegmentManager — Property 2: floor continuity', () => {
  /**
   * worldOffsetForIndex(0) === startRightEdgeX (flush start seam, Req 3.1), and for
   * every n >= 1, worldOffsetForIndex(n) === the prior segment's right edge
   * (worldOffsetForIndex(n-1) + segmentWidthPx) — zero gap / overlap (Req 3.5, 5.2).
   * **Validates: Requirements 3.1, 3.5, 5.2**
   */
  it('stitches each segment flush with the previous (and seg 0 with the start map)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5000, max: 100000 }), // startRightEdgeX
        fc.integer({ min: 0, max: 200 }), // finalSegmentIndex
        (startRightEdgeX, finalSegmentIndex) => {
          const mgr = makeManager(startRightEdgeX, finalSegmentIndex);

          // Seg 0 begins exactly at the start-map floor right edge.
          expect(mgr.worldOffsetForIndex(0)).toBe(startRightEdgeX);

          for (let n = 1; n <= finalSegmentIndex; n++) {
            const prevRightEdge = mgr.worldOffsetForIndex(n - 1) + SEGMENT_WIDTH;
            expect(mgr.worldOffsetForIndex(n)).toBe(prevRightEdge);
            // Closed-form check: offset(n) === startRightEdgeX + n*width.
            expect(mgr.worldOffsetForIndex(n)).toBe(startRightEdgeX + n * SEGMENT_WIDTH);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
