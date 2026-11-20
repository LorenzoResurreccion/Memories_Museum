import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createTrail,
  stepTrail,
  followerPosition,
  clampPoint,
  distance,
  MAX_FRAME_DELTA_MS,
} from '../followerTrail.js';

const SPEED = 80;
const NUM_RUNS = 200;
const EPS = 0.001;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Frame delta that stays physical for Property 4: 1 to 100 ms. */
export const frameDelta = () => fc.integer({ min: 1, max: MAX_FRAME_DELTA_MS });

/** Max physical step for a frame delta. */
const maxStepFor = (deltaMs) => (SPEED * Math.min(deltaMs, MAX_FRAME_DELTA_MS)) / 1000;

const AXIS_HEADINGS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

/** One frame: delta, heading (axis-aligned for right-angle corners, or free), step fraction. */
const frame = () =>
  fc.record({
    deltaMs: frameDelta(),
    heading: fc.oneof(
      fc.constantFrom(...AXIS_HEADINGS),
      fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
    ),
    frac: fc.oneof(fc.constant(0), fc.constant(1), fc.double({ min: 0, max: 1, noNaN: true })),
  });

const toVector = (f) => {
  const len = f.frac * maxStepFor(f.deltaMs);
  return { deltaMs: f.deltaMs, dx: Math.cos(f.heading) * len, dy: Math.sin(f.heading) * len };
};

/**
 * A physical walk: a start point plus per-frame displacements whose lengths are
 * bounded by speed x dt. Mixes random walks (reversals and right-angle corners
 * arise naturally) with out-and-back routes (forward then exact reverse).
 */
export const physicalWalk = () =>
  fc.record({
    start: fc.record({
      x: fc.integer({ min: 0, max: 2000 }),
      y: fc.integer({ min: 0, max: 240 }),
    }),
    frames: fc.oneof(
      fc.array(frame(), { minLength: 1, maxLength: 150 }).map((fs) => fs.map(toVector)),
      fc.array(frame(), { minLength: 1, maxLength: 75 }).map((fs) => {
        const fwd = fs.map(toVector);
        const back = [...fwd].reverse().map((v) => ({ deltaMs: v.deltaMs, dx: -v.dx, dy: -v.dy }));
        return [...fwd, ...back];
      }),
    ),
  });

const followDistance = () => fc.integer({ min: 1, max: 60 });

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

describe('followerTrail motion properties', () => {
  // Feature: follower-companion, Property 4: Distance invariant and convergence (Following mode)
  // **Validates: Requirements 3.1, 3.2, 3.4, 12.4**
  it('Property 4: gap never exceeds followDistance, converges once walked far enough, and holds after a stop', () => {
    fc.assert(
      fc.property(
        physicalWalk(),
        followDistance(),
        frameDelta(),
        (walk, fd, tailDelta) => {
          let state = createTrail(walk.start);
          let pos = { ...walk.start };
          let walked = 0;

          for (const v of walk.frames) {
            const next = { x: pos.x + v.dx, y: pos.y + v.dy };
            walked += distance(pos, next);
            pos = next;
            const res = stepTrail(state, pos, {
              followDistance: fd,
              deltaMs: v.deltaMs,
              speed: SPEED,
            });
            expect(res.teleported).toBe(false);
            state = res.state;

            expect(state.gap).toBeLessThanOrEqual(fd + EPS);
            if (walked >= fd) {
              expect(Math.abs(state.gap - fd)).toBeLessThanOrEqual(1);
            }
          }

          // Stop tail: same position repeated.
          const maxStep = maxStepFor(tailDelta);
          const framesNeeded = Math.max(0, Math.ceil((state.gap - fd) / maxStep));
          for (let i = 0; i < framesNeeded; i++) {
            state = stepTrail(state, pos, {
              followDistance: fd,
              deltaMs: tailDelta,
              speed: SPEED,
            }).state;
          }
          expect(state.gap).toBeLessThanOrEqual(fd + 1e-9);
          if (walked >= fd) {
            expect(Math.abs(state.gap - fd)).toBeLessThanOrEqual(1e-9);
          }

          // The trail-following step no longer moves the Follower.
          const settledPos = followerPosition(state);
          for (let i = 0; i < 5; i++) {
            state = stepTrail(state, pos, {
              followDistance: fd,
              deltaMs: tailDelta,
              speed: SPEED,
            }).state;
            const p = followerPosition(state);
            expect(distance(p, settledPos)).toBeLessThanOrEqual(1e-6);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: follower-companion, Property 5: Hold inside the follow distance (Following mode)
  // **Validates: Requirements 3.5, 3.7, 4.5, 4.8, 6.7**
  it('Property 5: follower holds while gap <= followDistance', () => {
    /** A valid trail state with 0 <= gap <= min(fd, pathLength); includes one-sample trails. */
    const validState = () =>
      fc
        .record({
          start: fc.record({
            x: fc.integer({ min: 0, max: 2000 }),
            y: fc.integer({ min: 0, max: 240 }),
          }),
          steps: fc.array(
            fc.record({
              dx: fc.double({ min: -5, max: 5, noNaN: true }),
              dy: fc.double({ min: -5, max: 5, noNaN: true }),
            }),
            { minLength: 0, maxLength: 40 },
          ),
          fd: followDistance(),
          gapFrac: fc.oneof(
            fc.constant(0),
            fc.constant(1),
            fc.double({ min: 0, max: 1, noNaN: true }),
          ),
        })
        .map(({ start, steps, fd, gapFrac }) => {
          const samples = [start];
          for (const s of steps) {
            const last = samples[samples.length - 1];
            samples.push({ x: last.x + s.dx, y: last.y + s.dy });
          }
          let len = 0;
          for (let i = 1; i < samples.length; i++) len += distance(samples[i - 1], samples[i]);
          const gap = Math.min(gapFrac * Math.min(fd, len), fd, len);
          return { state: { samples, gap }, fd };
        });

    fc.assert(
      fc.property(
        validState(),
        frameDelta(),
        fc.constantFrom(...AXIS_HEADINGS, 0.7),
        fc.double({ min: 0, max: 1, noNaN: true }),
        ({ state, fd }, deltaMs, heading, frac) => {
          const newest = state.samples[state.samples.length - 1];
          const before = followerPosition(state);
          const params = { followDistance: fd, deltaMs, speed: SPEED };

          // Stationary Player at the newest sample: follower must not move.
          let res;
          expect(() => {
            res = stepTrail(state, newest, params);
          }).not.toThrow();
          expect(res.teleported).toBe(false);
          expect(distance(followerPosition(res.state), before)).toBeLessThanOrEqual(1e-6);

          // Player moves: follower may only move if the pre-advance gap exceeds fd.
          const len = frac * maxStepFor(deltaMs);
          const moved = {
            x: newest.x + Math.cos(heading) * len,
            y: newest.y + Math.sin(heading) * len,
          };
          const preAdvanceGap = state.gap + distance(newest, moved);
          const res2 = stepTrail(state, moved, params);
          expect(res2.teleported).toBe(false);
          if (preAdvanceGap <= fd) {
            expect(distance(followerPosition(res2.state), before)).toBeLessThanOrEqual(1e-6);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: follower-companion, Property 6: Per-frame speed bound
  // **Validates: Requirements 3.3, 4.6**
  it('Property 6: follower moves at most speed x min(dt,100)/1000 + 1 px per frame, and per window of <= 100 ms', () => {
    const step = () =>
      fc.record({
        deltaMs: fc.integer({ min: 0, max: 200 }),
        heading: fc.oneof(
          fc.constantFrom(...AXIS_HEADINGS),
          fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        ),
        // Player step length up to 60 px (below the teleport threshold), so a
        // big step is allowed and the Follower simply lags.
        len: fc.oneof(
          fc.constant(0),
          fc.constant(60),
          fc.double({ min: 0, max: 60, noNaN: true }),
        ),
      });

    fc.assert(
      fc.property(
        fc.record({
          x: fc.integer({ min: 0, max: 2000 }),
          y: fc.integer({ min: 0, max: 240 }),
        }),
        fc.array(step(), { minLength: 1, maxLength: 150 }),
        followDistance(),
        (start, steps, fd) => {
          let state = createTrail(start);
          let pos = { ...start };
          const moves = [];
          const deltas = [];

          for (const s of steps) {
            const before = followerPosition(state);
            pos = {
              x: pos.x + Math.cos(s.heading) * s.len,
              y: pos.y + Math.sin(s.heading) * s.len,
            };
            const res = stepTrail(state, pos, {
              followDistance: fd,
              deltaMs: s.deltaMs,
              speed: SPEED,
            });
            expect(res.teleported).toBe(false);
            state = res.state;
            const moved = distance(before, followerPosition(state));
            moves.push(moved);
            deltas.push(s.deltaMs);
            expect(moved).toBeLessThanOrEqual(maxStepFor(s.deltaMs) + 1);
          }

          // Every window of consecutive frames totalling <= 100 ms.
          for (let i = 0; i < moves.length; i++) {
            let total = 0;
            let sum = 0;
            for (let j = i; j < moves.length; j++) {
              total += deltas[j];
              if (total > MAX_FRAME_DELTA_MS) break;
              sum += moves[j];
              const frames = j - i + 1;
              expect(sum).toBeLessThanOrEqual(SPEED * 0.1 + frames);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: follower-companion, Property 9: Hallway bounds clamp
  // **Validates: Requirements 8.1, 8.4, 8.5, 8.8**
  it('Property 9: clampPoint stays inside bounds, is identity inside, idempotent, and a no-op for in-bounds walks', () => {
    /** One axis: integer min <= max, with optional missing / infinite edges. */
    const axis = () =>
      fc
        .tuple(
          fc.integer({ min: -500, max: 3000 }),
          fc.integer({ min: 0, max: 3000 }),
          fc.constantFrom('both', 'both', 'both', 'noMin', 'noMax', 'inf', 'none'),
        )
        .map(([lo, span, kind]) => {
          const min = lo;
          const max = lo + span;
          switch (kind) {
            case 'noMin': return { max };
            case 'noMax': return { min };
            case 'inf': return { min: -Infinity, max: Infinity };
            case 'none': return {};
            default: return { min, max };
          }
        });
    const boundsGen = () =>
      fc.tuple(axis(), axis()).map(([ax, ay]) => ({
        minX: ax.min, maxX: ax.max, minY: ay.min, maxY: ay.max,
      }));
    const inside = (p, b) =>
      p.x >= (b.minX ?? -Infinity) && p.x <= (b.maxX ?? Infinity) &&
      p.y >= (b.minY ?? -Infinity) && p.y <= (b.maxY ?? Infinity);

    // Pure clamp properties.
    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: -5000, max: 5000, noNaN: true }),
          y: fc.double({ min: -5000, max: 5000, noNaN: true }),
        }),
        boundsGen(),
        (p, b) => {
          const c = clampPoint(p, b);
          expect(inside(c, b)).toBe(true);
          if (inside(p, b)) expect(c).toEqual(p);
          expect(clampPoint(c, b)).toEqual(c);
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // Walk whose Player positions are all clamped into the bounds.
    const fixedBounds = () =>
      fc
        .tuple(
          fc.integer({ min: 0, max: 1500 }), fc.integer({ min: 0, max: 600 }),
          fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }),
        )
        .map(([x0, w, y0, h]) => ({ minX: x0, maxX: x0 + w, minY: y0, maxY: y0 + h }));

    fc.assert(
      fc.property(physicalWalk(), fixedBounds(), followDistance(), (walk, b, fd) => {
        let pos = clampPoint(walk.start, b);
        let state = createTrail(pos);
        for (const v of walk.frames) {
          pos = clampPoint({ x: pos.x + v.dx, y: pos.y + v.dy }, b);
          const res = stepTrail(state, pos, { followDistance: fd, deltaMs: v.deltaMs, speed: SPEED });
          expect(res.teleported).toBe(false);
          state = res.state;
          const raw = followerPosition(state);
          const clamped = clampPoint(raw, b);
          expect(clamped.x).toBeCloseTo(raw.x, 9);
          expect(clamped.y).toBeCloseTo(raw.y, 9);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
