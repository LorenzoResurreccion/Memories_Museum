import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  facingFromDelta,
  frameIndexFor,
  resolveFollowerDepth,
  shouldSettle,
  stepToward,
  reseedTrail,
  followerPosition,
  distance,
  MOVE_EPSILON_PX,
} from '../followerTrail.js';

const facingArb = fc.constantFrom('up', 'down', 'left', 'right');

// Magnitudes across scales, plus values straddling the 0.1 threshold.
const magnitudeArb = fc.oneof(
  fc.double({ min: 0, max: 1000, noNaN: true }),
  fc.double({ min: 0, max: 0.3, noNaN: true }),
  fc.constantFrom(0, MOVE_EPSILON_PX, MOVE_EPSILON_PX - 1e-9, MOVE_EPSILON_PX + 1e-9, 0.05, 1),
);
const signArb = fc.constantFrom(1, -1);
const componentArb = fc.tuple(magnitudeArb, signArb).map(([m, s]) => m * s);

// Displacements with a deliberate share of exact |dx| === |dy| ties.
const deltaArb = fc.oneof(
  fc.tuple(componentArb, componentArb),
  fc.tuple(magnitudeArb, signArb, signArb).map(([m, sx, sy]) => [m * sx, m * sy]),
);

describe('followerTrail helpers (properties)', () => {
  // Feature: follower-companion, Property 12: Facing follows the dominant axis
  // **Validates: Requirements 5.1, 5.5**
  it('Property 12: facing follows the dominant axis', () => {
    fc.assert(
      fc.property(deltaArb, facingArb, ([dx, dy], prev) => {
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        const result = facingFromDelta(dx, dy, prev);
        if (Math.max(ax, ay) < 0.1) {
          expect(result).toBe(prev);
        } else if (ax >= ay) {
          expect(result).toBe(dx < 0 ? 'left' : 'right');
        } else {
          expect(result).toBe(dy < 0 ? 'up' : 'down');
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: follower-companion, Property 13: Frame index mapping
  // **Validates: Requirements 5.6, 1.3**
  it('Property 13: frame index equals row*4 + column and idle frame is in the facing row', () => {
    const rows = { down: 0, left: 1, right: 2, up: 3 };
    fc.assert(
      fc.property(facingArb, fc.integer({ min: 0, max: 3 }), (facing, column) => {
        const idx = frameIndexFor(facing, column);
        expect(idx).toBe(rows[facing] * 4 + column);
        expect(Math.floor(idx / 4)).toBe(rows[facing]);
        expect(Math.floor(frameIndexFor(facing, 0) / 4)).toBe(rows[facing]);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: follower-companion, Property 14: Depth ordering with stable ties
  // **Validates: Requirements 1.5, 1.6**
  it('Property 14: follower depth is above the player when lower on screen, otherwise below', () => {
    // Realistic hallway Y values only (|y| <= 1e5): for huge magnitudes,
    // subtracting DEPTH_TIE_EPSILON (0.001) can be lost to float precision.
    const yArb = fc.oneof(
      fc.integer({ min: 0, max: 240 }),
      fc.integer({ min: 0, max: 960 }).map((q) => q / 4),
      fc.double({ min: -1e5, max: 1e5, noNaN: true, noDefaultInfinity: true }),
    );
    // Pairs with a deliberate share of exact ties.
    const pairArb = fc.oneof(
      fc.tuple(yArb, yArb),
      yArb.map((y) => [y, y]),
    );
    fc.assert(
      fc.property(pairArb, ([followerY, playerY]) => {
        const depth = resolveFollowerDepth(followerY, playerY);
        if (followerY > playerY) {
          expect(depth).toBeGreaterThan(playerY);
        } else {
          expect(depth).toBeLessThan(playerY);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: follower-companion, Property 19: Settle step speed, snap, rounding and clamp (stepToward part)
  // **Validates: Requirements 13.2, 13.3, 13.10, 4.6**
  it('Property 19 (stepToward): bounded step, no overshoot, arrived iff at target, invalid maxStep holds', () => {
    // Integers and quarter-pixel fractions in +-500, with a share of near/coincident targets.
    const coordArb = fc.oneof(
      fc.integer({ min: -500, max: 500 }),
      fc.integer({ min: -2000, max: 2000 }).map((q) => q / 4),
    );
    const pointArb = fc.record({ x: coordArb, y: coordArb });
    const maxStepArb = fc.oneof(
      fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 0, max: 1e-6, noNaN: true, noDefaultInfinity: true }),
      fc.constantFrom(0, 1, 20),
    );
    const pairArb = fc.oneof(
      fc.tuple(pointArb, pointArb),
      fc.tuple(pointArb, fc.integer({ min: -3, max: 3 }), fc.integer({ min: -3, max: 3 })).map(
        ([p, dx, dy]) => [p, { x: p.x + dx / 2, y: p.y + dy / 2 }],
      ),
      pointArb.map((p) => [p, { ...p }]),
    );
    const eps = 1e-9;

    fc.assert(
      fc.property(pairArb, maxStepArb, ([from, to], maxStep) => {
        const { pos, arrived } = stepToward(from, to, maxStep);
        const moved = distance(from, pos);
        const total = distance(from, to);
        expect(moved).toBeLessThanOrEqual(Math.max(maxStep, 1) + eps);
        expect(distance(pos, to)).toBeLessThanOrEqual(total + eps);
        // pos lies on the segment from -> to
        expect(moved + distance(pos, to)).toBeLessThanOrEqual(total + eps);
        expect(arrived).toBe(pos.x === to.x && pos.y === to.y);
      }),
      { numRuns: 200 },
    );

    const badStepArb = fc.oneof(
      fc.double({ max: -Number.MIN_VALUE, noNaN: true, noDefaultInfinity: true }),
      fc.constantFrom(NaN, Infinity, -Infinity),
    );
    fc.assert(
      fc.property(pointArb, pointArb, badStepArb, (from, to, maxStep) => {
        const { pos, arrived } = stepToward(from, to, maxStep);
        expect(pos).toEqual(from);
        expect(pos).not.toBe(from);
        expect(arrived).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: follower-companion, Property 23: Reseed trail
  // **Validates: Requirements 13.6, 13.7, 2.3**
  it('Property 23: reseedTrail places the follower at f, gap = distance, newest = p, samples are copies', () => {
    const coordArb = fc.oneof(
      fc.integer({ min: -500, max: 500 }),
      fc.integer({ min: -2000, max: 2000 }).map((q) => q / 4),
    );
    const pointArb = fc.record({ x: coordArb, y: coordArb });
    const pairArb = fc.oneof(
      fc.tuple(pointArb, pointArb),
      pointArb.map((p) => [p, { ...p }]),
    );
    const eps = 1e-9;

    fc.assert(
      fc.property(pairArb, ([f, p]) => {
        const fCopy = { ...f };
        const pCopy = { ...p };
        const state = reseedTrail(f, p);
        const expectedGap = Math.hypot(p.x - f.x, p.y - f.y);
        const pos = followerPosition(state);
        const newest = state.samples[state.samples.length - 1];

        expect(Math.abs(pos.x - f.x)).toBeLessThanOrEqual(eps);
        expect(Math.abs(pos.y - f.y)).toBeLessThanOrEqual(eps);
        expect(Math.abs(state.gap - expectedGap)).toBeLessThanOrEqual(eps);
        expect(newest).toEqual(pCopy);

        if (f.x === p.x && f.y === p.y) {
          expect(state.samples).toHaveLength(1);
          expect(state.gap).toBe(0);
        } else {
          expect(state.samples).toHaveLength(2);
        }

        // Samples are copies: mutating inputs afterwards leaves the result unchanged.
        const snapshot = JSON.parse(JSON.stringify(state));
        f.x += 7; f.y -= 3; p.x -= 5; p.y += 11;
        expect(state).toEqual(snapshot);
        state.samples.forEach((s) => {
          expect(s).not.toBe(f);
          expect(s).not.toBe(p);
        });
        expect(fCopy).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: follower-companion, Property 18: Settle trigger predicate
  // **Validates: Requirements 13.1, 13.8, 13.12**
  describe('Property 18: settle trigger predicate', () => {
    const coordArb = fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true });
    const pointArb = fc.record({ x: coordArb, y: coordArb });
    const fdArb = fc.oneof(
      fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
      fc.constantFrom(0, 24, 16),
    );
    const minSepArb = fc.oneof(
      fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
      fc.constantFrom(0, 16),
    );
    const gapArb = fc.double({ min: 0, max: 200, noNaN: true, noDefaultInfinity: true });

    const oracle = ({ playerStopped, gap, followDistance, followerPos, playerPos }, minSep) =>
      playerStopped === true &&
      gap <= followDistance + 1 &&
      Math.hypot(playerPos.x - followerPos.x, playerPos.y - followerPos.y) < minSep;

    it('matches the oracle for arbitrary finite inputs (explicit minSeparation)', () => {
      fc.assert(
        fc.property(fc.boolean(), gapArb, fdArb, pointArb, pointArb, minSepArb, (playerStopped, gap, followDistance, followerPos, playerPos, minSeparation) => {
          const args = { playerStopped, gap, followDistance, followerPos, playerPos };
          expect(shouldSettle({ ...args, minSeparation })).toBe(oracle(args, minSeparation));
          if (!playerStopped) expect(shouldSettle({ ...args, minSeparation })).toBe(false);
          const dist = Math.hypot(playerPos.x - followerPos.x, playerPos.y - followerPos.y);
          if (dist >= minSeparation) expect(shouldSettle({ ...args, minSeparation })).toBe(false);
        }),
        { numRuns: 200 },
      );
    });

    it('uses the default minSeparation of 16 when omitted', () => {
      fc.assert(
        fc.property(fc.boolean(), gapArb, fdArb, pointArb, fc.double({ min: 0, max: 40, noNaN: true }), (playerStopped, gap, followDistance, followerPos, d) => {
          const playerPos = { x: followerPos.x + d, y: followerPos.y };
          const args = { playerStopped, gap, followDistance, followerPos, playerPos };
          expect(shouldSettle(args)).toBe(oracle(args, 16));
        }),
        { numRuns: 100 },
      );
    });

    it('handles boundaries: gap exactly followDistance + 1 and distance exactly minSeparation', () => {
      fc.assert(
        fc.property(fdArb, minSepArb, (followDistance, minSeparation) => {
          const followerPos = { x: 0, y: 0 };
          const near = { x: Math.max(0, minSeparation - 1e-6), y: 0 };
          const exact = { x: minSeparation, y: 0 };
          const gapAt = followDistance + 1;
          const gapOver = gapAt + 1e-6;
          // gap at the tolerance edge is accepted (when strictly inside separation)
          expect(shouldSettle({ playerStopped: true, gap: gapAt, followDistance, followerPos, playerPos: near, minSeparation }))
            .toBe(Math.hypot(near.x, near.y) < minSeparation);
          // distance exactly minSeparation is rejected
          expect(shouldSettle({ playerStopped: true, gap: gapAt, followDistance, followerPos, playerPos: exact, minSeparation })).toBe(false);
          // gap beyond tolerance is rejected
          if (gapOver > gapAt) {
            expect(shouldSettle({ playerStopped: true, gap: gapOver, followDistance, followerPos, playerPos: followerPos, minSeparation: minSeparation + 1 })).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('returns false for any non-finite numeric input', () => {
      const badArb = fc.constantFrom(NaN, Infinity, -Infinity);
      const fieldArb = fc.constantFrom('gap', 'followDistance', 'minSeparation', 'fx', 'fy', 'px', 'py');
      fc.assert(
        fc.property(fieldArb, badArb, (field, bad) => {
          const a = { gap: 0, followDistance: 24, minSeparation: 16, fx: 0, fy: 0, px: 0, py: 0 };
          a[field] = bad;
          expect(
            shouldSettle({
              playerStopped: true,
              gap: a.gap,
              followDistance: a.followDistance,
              minSeparation: a.minSeparation,
              followerPos: { x: a.fx, y: a.fy },
              playerPos: { x: a.px, y: a.py },
            }),
          ).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });
});
