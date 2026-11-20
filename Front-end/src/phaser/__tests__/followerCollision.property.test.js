import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  footprintAt,
  rectsOverlap,
  isValidPosition,
  segmentClear,
  chooseSettleTarget,
  FOLLOWER_FOOTPRINT_PX,
} from '../followerCollision.js';
import { restSpotCandidates } from '../followerTrail.js';

// ---------------------------------------------------------------------------
// Reusable generators (shared with later properties in this file).
// Fractional values are multiples of 0.25 so float arithmetic stays exact and
// the oracle and the implementation cannot disagree through rounding.
// ---------------------------------------------------------------------------

/** Coordinate: integer or quarter-pixel fraction. */
const coord = fc.oneof(
  fc.integer({ min: -200, max: 200 }),
  fc.integer({ min: -800, max: 800 }).map((n) => n / 4),
);

/** Feet point with integer or fractional coordinates. */
const feetPoint = fc.record({ x: coord, y: coord });

/** Rectangle with integer or fractional position and sizes 1-48. */
const rect = fc.record({
  x: coord,
  y: coord,
  width: fc.oneof(fc.integer({ min: 1, max: 48 }), fc.integer({ min: 4, max: 192 }).map((n) => n / 4)),
  height: fc.oneof(fc.integer({ min: 1, max: 48 }), fc.integer({ min: 4, max: 192 }).map((n) => n / 4)),
});

/**
 * A rectangle placed exactly touching one edge (or corner) of the footprint at
 * `feet`, so it must not overlap it.
 */
function touchingBox(feet) {
  const fp = footprintAt(feet);
  return fc
    .record({
      w: fc.integer({ min: 1, max: 48 }),
      h: fc.integer({ min: 1, max: 48 }),
      side: fc.constantFrom('left', 'right', 'top', 'bottom', 'tl', 'tr', 'bl', 'br'),
      slide: fc.integer({ min: -15, max: 15 }),
    })
    .map(({ w, h, side, slide }) => {
      const right = fp.x + fp.width;
      const bottom = fp.y + fp.height;
      switch (side) {
        case 'left': return { x: fp.x - w, y: fp.y + slide, width: w, height: h };
        case 'right': return { x: right, y: fp.y + slide, width: w, height: h };
        case 'top': return { x: fp.x + slide, y: fp.y - h, width: w, height: h };
        case 'bottom': return { x: fp.x + slide, y: bottom, width: w, height: h };
        case 'tl': return { x: fp.x - w, y: fp.y - h, width: w, height: h };
        case 'tr': return { x: right, y: fp.y - h, width: w, height: h };
        case 'bl': return { x: fp.x - w, y: bottom, width: w, height: h };
        default: return { x: right, y: bottom, width: w, height: h };
      }
    });
}

/** 0-12 rects, mixing free boxes with ones exactly touching the footprint. */
function boxSetFor(feet) {
  return fc.array(fc.oneof(rect, touchingBox(feet)), { minLength: 0, maxLength: 12 });
}

/** Bounds with integer edges, min <= max, on both axes. */
const bounds = fc
  .tuple(
    fc.integer({ min: -200, max: 200 }),
    fc.integer({ min: 0, max: 400 }),
    fc.integer({ min: -200, max: 200 }),
    fc.integer({ min: 0, max: 400 }),
  )
  .map(([minX, wx, minY, wy]) => ({ minX, maxX: minX + wx, minY, maxY: minY + wy }));

// Independent oracle for intersection area.
function intersectionArea(a, b) {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return w * h;
}

describe('followerCollision properties', () => {
  // Feature: follower-companion, Property 24: Footprint and rectangle overlap agree with an area oracle
  // **Validates: Requirements 12.8, 13.4, 13.13**
  describe('Property 24: Footprint and rectangle overlap agree with an area oracle', () => {
    it('footprintAt is 16x16, centered on feet.x, bottom edge at feet.y', () => {
      fc.assert(
        fc.property(feetPoint, (feet) => {
          const fp = footprintAt(feet);
          expect(fp.width).toBe(FOLLOWER_FOOTPRINT_PX);
          expect(fp.height).toBe(FOLLOWER_FOOTPRINT_PX);
          expect(FOLLOWER_FOOTPRINT_PX).toBe(16);
          expect(fp.x + fp.width / 2).toBe(feet.x);
          expect(fp.y + fp.height).toBe(feet.y);
        }),
        { numRuns: 100 },
      );
    });

    it('rectsOverlap is true iff the oracle intersection area is > 0, and symmetric', () => {
      fc.assert(
        fc.property(rect, rect, (a, b) => {
          const expected = intersectionArea(a, b) > 0;
          expect(rectsOverlap(a, b)).toBe(expected);
          expect(rectsOverlap(b, a)).toBe(expected);
        }),
        { numRuns: 200 },
      );
    });

    it('rectangles that only touch an edge or corner do not overlap', () => {
      fc.assert(
        fc.property(
          feetPoint.chain((feet) => fc.tuple(fc.constant(feet), touchingBox(feet))),
          ([feet, box]) => {
            const fp = footprintAt(feet);
            expect(rectsOverlap(fp, box)).toBe(false);
            expect(rectsOverlap(box, fp)).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('isValidPosition is true iff feet are inside bounds (inclusive) and no box overlaps the footprint', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Mostly inside the bounds range, with some outside, and exact edges.
            feetPoint,
            fc.record({
              x: fc.constantFrom(-50, 0, 50, 100),
              y: fc.constantFrom(-50, 0, 50, 100),
            }),
          ).chain((feet) => fc.tuple(fc.constant(feet), boxSetFor(feet), bounds)),
          ([feet, boxes, b]) => {
            const inBounds =
              feet.x >= b.minX && feet.x <= b.maxX && feet.y >= b.minY && feet.y <= b.maxY;
            const fp = footprintAt(feet);
            const noHit = boxes.every((box) => intersectionArea(fp, box) === 0);
            expect(isValidPosition(feet, boxes, b)).toBe(inBounds && noHit);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('isValidPosition with no bounds ignores bounds and only checks boxes', () => {
      fc.assert(
        fc.property(
          feetPoint.chain((feet) => fc.tuple(fc.constant(feet), boxSetFor(feet))),
          ([feet, boxes]) => {
            const fp = footprintAt(feet);
            const noHit = boxes.every((box) => intersectionArea(fp, box) === 0);
            expect(isValidPosition(feet, boxes)).toBe(noHit);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: follower-companion, Property 25: Segment sweep matches a dense-sampling oracle
  // **Validates: Requirements 12.8, 13.14**
  describe('Property 25: Segment sweep matches a dense-sampling oracle', () => {
    const EPS = 0.001;
    const SAMPLES = 200;

    /** Overlap extents (px) of two rects on each axis; negative means a gap. */
    function overlapExtents(a, b) {
      return {
        ox: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        oy: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
      };
    }

    /** Sampling oracle: some sample overlaps a box by more than EPS in both axes. */
    function sampledHit(from, to, boxes) {
      for (let i = 0; i <= SAMPLES; i += 1) {
        const t = i / SAMPLES;
        const fp = footprintAt({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
        for (const box of boxes) {
          const { ox, oy } = overlapExtents(fp, box);
          if (ox > EPS && oy > EPS) return true;
        }
      }
      return false;
    }

    /**
     * Parametric oracle: does the segment pass through the Minkowski-expanded
     * box grown by `margin` px (negative shrinks)? Open interval test.
     */
    function paramHit(from, to, boxes, margin, size = 16) {
      const half = size / 2;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const interval = (c, d, lo, hi) => {
        if (lo >= hi) return null;
        if (d === 0) return c > lo && c < hi ? [-Infinity, Infinity] : null;
        const t1 = (lo - c) / d;
        const t2 = (hi - c) / d;
        return t1 < t2 ? [t1, t2] : [t2, t1];
      };
      return boxes.some((box) => {
        const ix = interval(from.x, dx, box.x - half - margin, box.x + box.width + half + margin);
        const iy = interval(from.y, dy, box.y - margin, box.y + box.height + size + margin);
        if (!ix || !iy) return false;
        const a = Math.max(ix[0], iy[0]);
        const b = Math.min(ix[1], iy[1]);
        return a < b && b > 0 && a < 1;
      });
    }

    /** Segment generator: zero-length, horizontal, vertical, or diagonal. */
    const segment = fc
      .tuple(
        feetPoint,
        fc.constantFrom('zero', 'horizontal', 'vertical', 'diagonal'),
        feetPoint,
      )
      .map(([from, kind, other]) => {
        switch (kind) {
          case 'zero': return { from, to: { ...from }, kind };
          case 'horizontal': return { from, to: { x: other.x, y: from.y }, kind };
          case 'vertical': return { from, to: { x: from.x, y: other.y }, kind };
          default: return { from, to: other, kind };
        }
      });

    /** Segment plus 0-12 boxes: free, touching either endpoint, or on the segment. */
    const scenario = segment.chain((seg) => {
      const mid = { x: (seg.from.x + seg.to.x) / 2, y: (seg.from.y + seg.to.y) / 2 };
      const onSegment = fc
        .record({
          w: fc.integer({ min: 1, max: 48 }),
          h: fc.integer({ min: 1, max: 48 }),
          dx: fc.integer({ min: -8, max: 8 }),
          dy: fc.integer({ min: -8, max: 8 }),
        })
        .map(({ w, h, dx, dy }) => ({ x: mid.x + dx - w / 2, y: mid.y + dy - h / 2, width: w, height: h }));
      const boxes = fc.array(
        fc.oneof(rect, touchingBox(seg.from), touchingBox(seg.to), onSegment),
        { minLength: 0, maxLength: 12 },
      );
      return fc.tuple(fc.constant(seg), boxes);
    });

    it('is false whenever a dense sample overlaps a box by more than 0.001 px in both axes', () => {
      fc.assert(
        fc.property(scenario, ([{ from, to }, boxes]) => {
          fc.pre(sampledHit(from, to, boxes));
          expect(segmentClear(from, to, boxes)).toBe(false);
        }),
        { numRuns: 200 },
      );
    });

    it('is true whenever the sweep clears every box by more than 0.001 px', () => {
      fc.assert(
        fc.property(scenario, ([{ from, to }, boxes]) => {
          fc.pre(!paramHit(from, to, boxes, EPS));
          expect(segmentClear(from, to, boxes)).toBe(true);
        }),
        { numRuns: 200 },
      );
    });

    it('agrees with the parametric oracle outside the 0.001 px ambiguity band', () => {
      fc.assert(
        fc.property(scenario, ([{ from, to }, boxes]) => {
          const grown = paramHit(from, to, boxes, EPS);
          const shrunk = paramHit(from, to, boxes, -EPS);
          fc.pre(grown === shrunk);
          expect(segmentClear(from, to, boxes)).toBe(!grown);
        }),
        { numRuns: 200 },
      );
    });

    it('is symmetric in from and to', () => {
      fc.assert(
        fc.property(scenario, ([{ from, to }, boxes]) => {
          expect(segmentClear(to, from, boxes)).toBe(segmentClear(from, to, boxes));
        }),
        { numRuns: 200 },
      );
    });

    it('a zero-length segment equals the footprint overlap test at the point', () => {
      fc.assert(
        fc.property(
          feetPoint.chain((p) => fc.tuple(fc.constant(p), boxSetFor(p))),
          ([p, boxes]) => {
            const expected = !boxes.some((b) => rectsOverlap(footprintAt(p), b));
            expect(segmentClear(p, { ...p }, boxes)).toBe(expected);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('an empty box list is always clear', () => {
      fc.assert(
        fc.property(feetPoint, feetPoint, (from, to) => {
          expect(segmentClear(from, to, [])).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('for axis-aligned segments equals "no box overlaps the swept bounding rectangle"', () => {
      const axisAligned = scenario.filter(([{ from, to }]) => from.x === to.x || from.y === to.y);
      fc.assert(
        fc.property(axisAligned, ([{ from, to }, boxes]) => {
          const a = footprintAt(from);
          const b = footprintAt(to);
          const minX = Math.min(a.x, b.x);
          const minY = Math.min(a.y, b.y);
          const swept = {
            x: minX,
            y: minY,
            width: Math.max(a.x + a.width, b.x + b.width) - minX,
            height: Math.max(a.y + a.height, b.y + b.height) - minY,
          };
          expect(segmentClear(from, to, boxes)).toBe(!boxes.some((box) => rectsOverlap(swept, box)));
        }),
        { numRuns: 200 },
      );
    });
  });

  // Feature: follower-companion, Property 17: Settle target is the first valid candidate, or null
  // **Validates: Requirements 13.4, 13.5, 13.14**
  describe('Property 17: Settle target is the first valid candidate, or null', () => {
    // Independent direction table (unit vector the player faces).
    const DIR = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    };

    function oracleCandidates(p, facing, d) {
      const v = DIR[facing];
      return [
        { x: p.x - v.x * d, y: p.y - v.y * d }, // behind
        { x: p.x + v.x * d, y: p.y + v.y * d }, // front
        { x: p.x, y: p.y - d }, // above
        { x: p.x, y: p.y + d }, // below
      ];
    }

    const facingArb = fc.constantFrom('up', 'down', 'left', 'right');
    const followDistanceArb = fc.oneof(
      fc.integer({ min: 1, max: 64 }),
      fc.integer({ min: 1, max: 256 }).map((n) => n / 4),
    );

    /** Box covering the footprint of `feet` (blocks that spot). */
    function coveringBox(feet) {
      return fc
        .record({ w: fc.integer({ min: 4, max: 40 }), h: fc.integer({ min: 4, max: 40 }) })
        .map(({ w, h }) => ({ x: feet.x - w / 2, y: feet.y - h / 2, width: w, height: h }));
    }

    /** Box straddling the midpoint of the route from `a` to `b`. */
    function routeBox(a, b) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return fc
        .record({
          w: fc.integer({ min: 1, max: 32 }),
          h: fc.integer({ min: 1, max: 32 }),
          dx: fc.integer({ min: -4, max: 4 }),
          dy: fc.integer({ min: -4, max: 4 }),
        })
        .map(({ w, h, dx, dy }) => ({ x: mid.x + dx - w / 2, y: mid.y + dy - h / 2, width: w, height: h }));
    }

    const scenario = fc
      .tuple(feetPoint, facingArb, followDistanceArb, fc.boolean(), feetPoint)
      .chain(([player, facing, d, followerAtPlayer, otherFollower]) => {
        const follower = followerAtPlayer ? { ...player } : otherFollower;
        const cands = oracleCandidates(player, facing, d);
        const boxArb = fc.oneof(
          rect,
          fc.oneof(...cands.map((c) => coveringBox(c))),
          fc.oneof(...cands.map((c) => routeBox(follower, c))),
          fc.oneof(...cands.map((c) => touchingBox(c))),
        );
        const boundsArb = fc.oneof(
          bounds,
          // Wide bounds around the player: all candidates inside.
          fc.constant({
            minX: player.x - d - 1, maxX: player.x + d + 1,
            minY: player.y - d - 1, maxY: player.y + d + 1,
          }),
          // Narrow bounds that exclude every candidate (null case).
          fc.constantFrom('right', 'left', 'above', 'below').map((side) => {
            const far = d + 1;
            switch (side) {
              case 'right': return { minX: player.x + far, maxX: player.x + far + 10, minY: -1000, maxY: 1000 };
              case 'left': return { minX: player.x - far - 10, maxX: player.x - far, minY: -1000, maxY: 1000 };
              case 'above': return { minX: -1000, maxX: 1000, minY: player.y - far - 10, maxY: player.y - far };
              default: return { minX: -1000, maxX: 1000, minY: player.y + far, maxY: player.y + far + 10 };
            }
          }),
        );
        return fc.tuple(
          fc.constant({ player, facing, d, follower }),
          fc.array(boxArb, { minLength: 0, maxLength: 12 }),
          boundsArb,
        );
      });

    it('restSpotCandidates returns behind, front, above, below, each followDistance from the player', () => {
      fc.assert(
        fc.property(scenario, ([{ player, facing, d }]) => {
          const got = restSpotCandidates(player, facing, d);
          expect(got).toEqual(oracleCandidates(player, facing, d));
          expect(got).toHaveLength(4);
          for (const c of got) {
            expect(Math.hypot(c.x - player.x, c.y - player.y)).toBeCloseTo(d, 9);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('chooseSettleTarget returns the first valid, route-clear candidate, or null', () => {
      fc.assert(
        fc.property(scenario, ([{ player, facing, d, follower }, boxes, b]) => {
          const cands = oracleCandidates(player, facing, d);
          const expected =
            cands.find((c) => isValidPosition(c, boxes, b) && segmentClear(follower, c, boxes)) ?? null;
          const got = chooseSettleTarget(player, facing, d, b, boxes, follower);
          expect(got).toEqual(expected);
          if (got !== null) {
            expect(cands.some((c) => c.x === got.x && c.y === got.y)).toBe(true);
          }
        }),
        { numRuns: 200 },
      );
    });

    it('returns null when bounds exclude every candidate', () => {
      fc.assert(
        fc.property(scenario, ([{ player, facing, d, follower }, boxes]) => {
          const far = d + 1;
          const b = { minX: player.x + far, maxX: player.x + far + 10, minY: -1000, maxY: 1000 };
          expect(chooseSettleTarget(player, facing, d, b, boxes, follower)).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('with no boxes and wide bounds the behind candidate is chosen', () => {
      fc.assert(
        fc.property(feetPoint, facingArb, followDistanceArb, (player, facing, d) => {
          const wide = {
            minX: player.x - d - 1, maxX: player.x + d + 1,
            minY: player.y - d - 1, maxY: player.y + d + 1,
          };
          const got = chooseSettleTarget(player, facing, d, wide, [], { ...player });
          expect(got).toEqual(oracleCandidates(player, facing, d)[0]);
        }),
        { numRuns: 100 },
      );
    });
  });
});
