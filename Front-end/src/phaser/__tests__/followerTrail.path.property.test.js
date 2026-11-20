import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createTrail,
  appendSample,
  pathLength,
  stepTrail,
  followerPosition,
  trimTrail,
  isValidStepInput,
  MAX_TRAIL_SAMPLES,
} from '../followerTrail.js';

// ---------------------------------------------------------------------------
// Generators (shared by the properties in this file)
// ---------------------------------------------------------------------------

/** Small integer-grid point so equal / revisited positions occur often. */
const gridPoint = fc.record({
  x: fc.integer({ min: 0, max: 5 }),
  y: fc.integer({ min: 0, max: 5 }),
});

/** Arbitrary finite point (continuous-ish values). */
const wildPoint = fc.record({
  x: fc.double({ min: -1000, max: 1000, noNaN: true }),
  y: fc.double({ min: -1000, max: 1000, noNaN: true }),
});

/**
 * A walk of Player positions that mixes fresh points, immediate repeats
 * (equal case) and revisits of earlier positions (backtracking, Req 4.3).
 * Encoded as ops resolved against the walk built so far.
 */
const walkArb = (maxLen = 60) =>
  fc
    .tuple(
      fc.oneof(gridPoint, wildPoint),
      fc.array(
        fc.oneof(
          { weight: 3, arbitrary: fc.record({ kind: fc.constant('new'), p: fc.oneof(gridPoint, wildPoint) }) },
          { weight: 2, arbitrary: fc.record({ kind: fc.constant('repeat') }) },
          { weight: 2, arbitrary: fc.record({ kind: fc.constant('revisit'), r: fc.nat(1000) }) },
        ),
        { maxLength: maxLen },
      ),
    )
    .map(([start, ops]) => {
      const walk = [start];
      for (const op of ops) {
        if (op.kind === 'new') walk.push(op.p);
        else if (op.kind === 'repeat') walk.push({ ...walk[walk.length - 1] });
        else walk.push({ ...walk[op.r % walk.length] });
      }
      return walk;
    });

/** Sample caps: default 256 and small caps that force eviction. */
const capArb = fc.oneof(fc.constant(MAX_TRAIL_SAMPLES), fc.integer({ min: 2, max: 8 }));

const same = (a, b) => a.x === b.x && a.y === b.y;

// ---------------------------------------------------------------------------

describe('followerTrail path recording (property)', () => {
  // Feature: follower-companion, Property 1: Recording appends exactly the changes, in order
  // **Validates: Requirements 2.1, 2.2, 2.3, 2.5, 4.3**
  it('Property 1: appendSample appends exactly the changes, in order, within the cap', () => {
    fc.assert(
      fc.property(walkArb(), capArb, (walk, cap) => {
        let state = createTrail(walk[0]);

        for (let i = 1; i < walk.length; i++) {
          const p = walk[i];
          const prev = state;
          const prevLast = prev.samples[prev.samples.length - 1];
          const next = appendSample(prev, p, cap);

          if (same(prevLast, p)) {
            // Equal position: trail unchanged.
            expect(next).toBe(prev);
            expect(next.samples).toEqual(prev.samples);
            expect(next.gap).toBe(prev.gap);
          } else {
            // Differing position: exactly one new sample, equal to p, at the end.
            const evicted = prev.samples.length + 1 > cap;
            const expectedLen = evicted ? cap : prev.samples.length + 1;
            expect(next.samples.length).toBe(expectedLen);
            expect(next.samples[next.samples.length - 1]).toEqual(p);

            // Earlier samples keep their order and values (only the oldest may drop).
            const keptOld = next.samples.slice(0, -1);
            const expectedOld = evicted
              ? prev.samples.slice(prev.samples.length - (cap - 1))
              : prev.samples;
            expect(keptOld).toEqual(expectedOld);

            if (evicted) {
              expect(next.gap).toBeGreaterThanOrEqual(0);
              expect(next.gap).toBeLessThanOrEqual(pathLength(next.samples) + 1e-9);
            }
          }

          // Invariants after every step.
          expect(next.samples.length).toBeLessThanOrEqual(cap);
          expect(next.gap).toBeGreaterThanOrEqual(0);
          expect(next.gap).toBeLessThanOrEqual(pathLength(next.samples) + 1e-9);
          for (let k = 1; k < next.samples.length; k++) {
            expect(same(next.samples[k - 1], next.samples[k])).toBe(false);
          }
          state = next;
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: follower-companion, Property 2: Path membership (Following mode)
  // **Validates: Requirements 3.6, 4.4, 4.7, 12.7**
  it('Property 2: follower stays on the trail polyline after every stepTrail, and on the walked path when returning', () => {
    /** Distance from point p to segment ab. */
    const distToSegment = (p, a, b) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    /** Oracle: point lies on the polyline through samples within eps. */
    const onPolyline = (point, samples, eps) => {
      if (samples.length === 1) {
        return Math.hypot(point.x - samples[0].x, point.y - samples[0].y) <= eps;
      }
      for (let i = 1; i < samples.length; i++) {
        if (distToSegment(point, samples[i - 1], samples[i]) <= eps) return true;
      }
      return false;
    };

    // Integer steps with |step| <= 45*sqrt(2) ~ 63.6 px, so never a teleport (> 64).
    const stepArb = fc.record({
      dx: fc.integer({ min: -45, max: 45 }),
      dy: fc.integer({ min: -45, max: 45 }),
    });
    const paramsArb = fc.record({
      followDistance: fc.integer({ min: 0, max: 120 }),
      deltaMs: fc.integer({ min: 0, max: 200 }),
      speed: fc.integer({ min: 0, max: 300 }),
    });
    const startArb = fc.record({
      x: fc.integer({ min: -500, max: 500 }),
      y: fc.integer({ min: -500, max: 500 }),
    });
    // Random walk, optionally followed by an exact return along the walked path.
    const scenarioArb = fc.record({
      start: startArb,
      steps: fc.array(stepArb, { minLength: 1, maxLength: 40 }),
      doReturn: fc.boolean(),
      params: paramsArb,
    });

    fc.assert(
      fc.property(scenarioArb, ({ start, steps, doReturn, params }) => {
        const walked = [start];
        for (const s of steps) {
          const last = walked[walked.length - 1];
          walked.push({ x: last.x + s.dx, y: last.y + s.dy });
        }
        const route = doReturn ? [...walked, ...[...walked].reverse().slice(1)] : walked;

        let state = createTrail(route[0]);
        for (let i = 1; i < route.length; i++) {
          const res = stepTrail(state, route[i], params);
          expect(res.teleported).toBe(false);
          state = res.state;
          expect(onPolyline(followerPosition(state), state.samples, 0.01)).toBe(true);
        }

        if (doReturn) {
          // Final follower lies on a segment of the walked path.
          expect(onPolyline(followerPosition(state), walked, 0.001)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: follower-companion, Property 3: Monotone progress along the recorded path
  // **Validates: Requirements 4.1, 4.2**
  it('Property 3: cumulative progress (recordedLength - gap) never decreases and samples are visited in order', () => {
    const EPS = 1e-9;
    const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

    /** Point at arclength s along the full recorded polyline (the test's own oracle). */
    const pointAtArc = (pts, cum, s) => {
      for (let i = 1; i < pts.length; i++) {
        if (s <= cum[i] + EPS) {
          const segLen = cum[i] - cum[i - 1];
          const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, (s - cum[i - 1]) / segLen));
          return {
            x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
            y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
          };
        }
      }
      return pts[pts.length - 1];
    };

    // Integer steps with |step| <= 45*sqrt(2) ~ 63.6 px: never a teleport (> 64).
    const stepArb = fc.record({
      dx: fc.integer({ min: -45, max: 45 }),
      dy: fc.integer({ min: -45, max: 45 }),
    });
    const axisStepArb = (axis) =>
      fc.integer({ min: 1, max: 60 }).map((n) => (axis === 'x' ? { dx: n, dy: 0 } : { dx: 0, dy: n }));
    const routeKindArb = fc.oneof(
      fc.record({ kind: fc.constant('random'), steps: fc.array(stepArb, { minLength: 1, maxLength: 40 }) }),
      fc.record({ kind: fc.constant('outback'), steps: fc.array(stepArb, { minLength: 1, maxLength: 25 }) }),
      fc.record({
        kind: fc.constant('corner'),
        steps: fc.tuple(
          fc.array(axisStepArb('x'), { minLength: 1, maxLength: 12 }),
          fc.array(axisStepArb('y'), { minLength: 1, maxLength: 12 }),
        ).map(([a, b]) => [...a, ...b]),
      }),
    );
    const scenarioArb = fc.record({
      start: fc.record({ x: fc.integer({ min: -500, max: 500 }), y: fc.integer({ min: -500, max: 500 }) }),
      route: routeKindArb,
      params: fc.record({
        followDistance: fc.integer({ min: 0, max: 120 }),
        deltaMs: fc.integer({ min: 0, max: 200 }),
        speed: fc.integer({ min: 0, max: 300 }),
      }),
    });

    fc.assert(
      fc.property(scenarioArb, ({ start, route, params }) => {
        const out = [start];
        for (const s of route.steps) {
          const last = out[out.length - 1];
          out.push({ x: last.x + s.dx, y: last.y + s.dy });
        }
        const walk = route.kind === 'outback' ? [...out, ...[...out].reverse().slice(1)] : out;

        // Oracle: recorded polyline (deduped consecutive points) and cumulative lengths.
        const pts = [start];
        const cum = [0];
        // First frame at which progress reached each recorded sample.
        const reachedAt = [0];
        let recordedLength = 0;

        let state = createTrail(start);
        let prevProgress = recordedLength - state.gap;

        for (let i = 1; i < walk.length; i++) {
          const p = walk[i];
          const newest = pts[pts.length - 1];
          if (!same(newest, p)) {
            recordedLength += dist(newest, p);
            pts.push({ x: p.x, y: p.y });
            cum.push(recordedLength);
            reachedAt.push(Infinity);
          }

          const res = stepTrail(state, p, params);
          expect(res.teleported).toBe(false);
          state = res.state;

          const progress = recordedLength - state.gap;
          // Never decreases.
          expect(progress).toBeGreaterThanOrEqual(prevProgress - EPS);
          prevProgress = progress;

          // Record the first frame each sample is reached.
          for (let k = 0; k < pts.length; k++) {
            if (reachedAt[k] === Infinity && progress >= cum[k] - EPS) reachedAt[k] = i;
          }

          // Follower sits at the recorded polyline point for its progress (visit order).
          const expected = pointAtArc(pts, cum, Math.max(0, progress));
          const actual = followerPosition(state);
          expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThanOrEqual(1e-6);
        }

        // Samples are reached in recording order: reversal / corner before any later sample.
        for (let k = 1; k < pts.length; k++) {
          expect(reachedAt[k]).toBeGreaterThanOrEqual(reachedAt[k - 1]);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: follower-companion, Property 7: Trim neutrality and bounded length
  // **Validates: Requirements 2.4, 12.5**
  it('Property 7: trimTrail keeps the follower in place, bounds the length, and is idempotent', () => {
    const EPS = 1e-9;

    // Inputs are pixel-scale on purpose: the game records positions in the
    // 0.25px..hundreds-of-px range and trims with a limit of 24+32 px. Denormal
    // coordinates (~5e-324) with a zero trim limit leave float remainders that
    // make a second trim drop another sample; that is outside the game's domain.
    // Coordinates are quarter-pixel multiples within +-500 and fd + slack >= 1.
    const quarterCoord = fc.integer({ min: -2000, max: 2000 }).map((n) => n / 4);
    const quarterPoint = fc.record({ x: quarterCoord, y: quarterCoord });
    const quarterWalkArb = fc
      .tuple(
        quarterPoint,
        fc.array(
          fc.oneof(
            { weight: 3, arbitrary: fc.record({ kind: fc.constant('new'), p: quarterPoint }) },
            { weight: 2, arbitrary: fc.record({ kind: fc.constant('repeat') }) },
            { weight: 2, arbitrary: fc.record({ kind: fc.constant('revisit'), r: fc.nat(1000) }) },
          ),
          { maxLength: 60 },
        ),
      )
      .map(([start, ops]) => {
        const walk = [start];
        for (const op of ops) {
          if (op.kind === 'new') walk.push(op.p);
          else if (op.kind === 'repeat') walk.push({ ...walk[walk.length - 1] });
          else walk.push({ ...walk[op.r % walk.length] });
        }
        return walk;
      });

    // Valid trail: >= 1 sample, no consecutive duplicates, 0 <= gap <= pathLength.
    const trailArb = fc
      .tuple(quarterWalkArb, fc.double({ min: 0, max: 1, noNaN: true }))
      .map(([walk, frac]) => {
        const samples = walk.filter((p, i) => i === 0 || !same(walk[i - 1], p));
        const gap = Math.min(frac * pathLength(samples), pathLength(samples));
        return { samples, gap };
      });
    const followDistArb = fc.oneof(
      fc.integer({ min: 1, max: 100 }),
      fc.double({ min: 1, max: 100, noNaN: true }),
    );
    const slackArb = fc.oneof(
      fc.integer({ min: 0, max: 100 }),
      fc.double({ min: 0, max: 100, noNaN: true }),
    );

    fc.assert(
      fc.property(trailArb, followDistArb, slackArb, (state, fd, slack) => {
        const out = trimTrail(state, fd, slack);

        // Neutral for the follower.
        const before = followerPosition(state);
        const after = followerPosition(out);
        expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.001);
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.001);

        // Structure and bounds.
        expect(out.samples.length).toBeGreaterThanOrEqual(1);
        const len = pathLength(out.samples);
        expect(out.gap).toBeGreaterThanOrEqual(0);
        expect(out.gap).toBeLessThanOrEqual(len + EPS);
        expect(len).toBeLessThanOrEqual(Math.max(fd + slack, state.gap) + EPS);

        // Idempotent.
        const again = trimTrail(out, fd, slack);
        expect(again.samples.length).toBe(out.samples.length);
        expect(Math.abs(pathLength(again.samples) - len)).toBeLessThanOrEqual(EPS);
        expect(Math.abs(again.gap - out.gap)).toBeLessThanOrEqual(EPS);
        const afterAgain = followerPosition(again);
        expect(Math.abs(afterAgain.x - after.x)).toBeLessThanOrEqual(EPS);
        expect(Math.abs(afterAgain.y - after.y)).toBeLessThanOrEqual(EPS);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: follower-companion, Property 8: Idempotence at rest
  // **Validates: Requirements 12.6, 2.2**
  it('Property 8: once settled with the Player fixed, one more stepTrail changes neither follower nor trail', () => {
    const SPEED = 80;
    // Integer steps with |step| <= 45*sqrt(2) ~ 63.6 px: never a teleport (> 64).
    const stepArb = fc.record({
      dx: fc.integer({ min: -45, max: 45 }),
      dy: fc.integer({ min: -45, max: 45 }),
      deltaMs: fc.integer({ min: 1, max: 100 }),
    });
    const scenarioArb = fc.record({
      start: fc.record({ x: fc.integer({ min: -500, max: 500 }), y: fc.integer({ min: -500, max: 500 }) }),
      steps: fc.array(stepArb, { minLength: 1, maxLength: 40 }),
      followDistance: fc.integer({ min: 1, max: 100 }),
      settleDeltaMs: fc.integer({ min: 1, max: 100 }),
    });

    fc.assert(
      fc.property(scenarioArb, ({ start, steps, followDistance, settleDeltaMs }) => {
        let player = start;
        let state = createTrail(start);
        for (const s of steps) {
          player = { x: player.x + s.dx, y: player.y + s.dy };
          const res = stepTrail(state, player, { followDistance, deltaMs: s.deltaMs, speed: SPEED });
          expect(res.teleported).toBe(false);
          state = res.state;
        }

        // Settle with the Player fixed at its final position.
        const params = { followDistance, deltaMs: settleDeltaMs, speed: SPEED };
        const minStep = (SPEED * settleDeltaMs) / 1000;
        const cap = Math.ceil(state.gap / minStep) + 5;
        for (let i = 0; i < cap && state.gap > followDistance + 1e-9; i++) {
          state = stepTrail(state, player, params).state;
        }
        expect(state.gap).toBeLessThanOrEqual(followDistance + 1e-9);

        const posBefore = followerPosition(state);
        const next = stepTrail(state, player, params);
        expect(next.teleported).toBe(false);
        const posAfter = followerPosition(next.state);

        expect(Math.abs(posAfter.x - posBefore.x)).toBeLessThanOrEqual(0.001);
        expect(Math.abs(posAfter.y - posBefore.y)).toBeLessThanOrEqual(0.001);
        // trimTrail re-interpolates the cut point, so float noise is expected.
        expect(next.state.samples.length).toBe(state.samples.length);
        next.state.samples.forEach((p, i) => {
          expect(Math.abs(p.x - state.samples[i].x)).toBeLessThanOrEqual(1e-9);
          expect(Math.abs(p.y - state.samples[i].y)).toBeLessThanOrEqual(1e-9);
        });
        expect(Math.abs(next.state.gap - state.gap)).toBeLessThanOrEqual(1e-9);
      }),
      { numRuns: 150 },
    );
  });

  // Feature: follower-companion, Property 10: Teleport reset versus continuity
  // **Validates: Requirements 8.6, 8.7**
  it('Property 10: a jump over 64 px resets the trail; a jump of at most 64 px continues it', () => {
    const SPEED = 80;
    const EPS = 1e-9;
    const stepArb = fc.record({
      dx: fc.integer({ min: -45, max: 45 }),
      dy: fc.integer({ min: -45, max: 45 }),
    });
    const paramsArb = fc.record({
      followDistance: fc.integer({ min: 1, max: 100 }),
      deltaMs: fc.integer({ min: 1, max: 100 }),
      speed: fc.constant(SPEED),
    });
    // (a) beyond the threshold: angle + distance in [64.01, 500]
    // (b) within it: exact 64 px axis step, or angle + distance in [0, 63.99]
    const jumpArb = fc.oneof(
      fc.record({
        teleport: fc.constant(true),
        angle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        dist: fc.double({ min: 64.01, max: 500, noNaN: true }),
      }),
      fc.record({
        teleport: fc.constant(false),
        angle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        dist: fc.double({ min: 0, max: 63.99, noNaN: true }),
      }),
      fc.record({
        teleport: fc.constant(false),
        axis: fc.constantFrom({ x: 64, y: 0 }, { x: -64, y: 0 }, { x: 0, y: 64 }, { x: 0, y: -64 }),
      }),
    );
    const scenarioArb = fc.record({
      start: fc.record({ x: fc.integer({ min: -500, max: 500 }), y: fc.integer({ min: -500, max: 500 }) }),
      steps: fc.array(stepArb, { minLength: 0, maxLength: 30 }),
      params: paramsArb,
      jump: jumpArb,
    });

    fc.assert(
      fc.property(scenarioArb, ({ start, steps, params, jump }) => {
        let player = start;
        let state = createTrail(start);
        for (const s of steps) {
          player = { x: player.x + s.dx, y: player.y + s.dy };
          state = stepTrail(state, player, params).state;
        }
        const prevNewest = state.samples[state.samples.length - 1];
        const p = jump.axis
          ? { x: prevNewest.x + jump.axis.x, y: prevNewest.y + jump.axis.y }
          : {
              x: prevNewest.x + Math.cos(jump.angle) * jump.dist,
              y: prevNewest.y + Math.sin(jump.angle) * jump.dist,
            };

        const res = stepTrail(state, p, params);

        if (jump.teleport) {
          // (a) Reset to a single sample at the new position.
          expect(res.teleported).toBe(true);
          expect(res.state.samples).toEqual([p]);
          expect(res.state.gap).toBe(0);
          return;
        }

        // (b) Continuity. Trimming only cuts the oldest end, so the newest sample
        // is always the Player position. The previous newest sample is either still
        // second-newest, or (when the last segment itself exceeds the trim limit)
        // replaced by an interpolated cut point lying on the prev->player segment.
        expect(res.teleported).toBe(false);
        const out = res.state.samples;
        expect(out[out.length - 1]).toEqual(p);

        if (!same(prevNewest, p) && out.length >= 2) {
          const second = out[out.length - 2];
          if (!same(second, prevNewest)) {
            const limit = Math.max(params.followDistance + 32, res.state.gap);
            expect(pathLength(out)).toBeLessThanOrEqual(limit + 1e-6);
            expect(out.length).toBe(2);
            const dPrev = Math.hypot(p.x - prevNewest.x, p.y - prevNewest.y);
            const dSecond = Math.hypot(p.x - second.x, p.y - second.y);
            const cross =
              (second.x - prevNewest.x) * (p.y - prevNewest.y) -
              (second.y - prevNewest.y) * (p.x - prevNewest.x);
            expect(dSecond).toBeLessThanOrEqual(dPrev + 1e-6);
            expect(Math.abs(cross)).toBeLessThanOrEqual(1e-6 * Math.max(1, dPrev));
          }
        }
        expect(res.state.gap).toBeGreaterThanOrEqual(0);
        expect(res.state.gap).toBeLessThanOrEqual(pathLength(out) + EPS);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: follower-companion, Property 11: Invalid inputs are a no-op
  // **Validates: Requirements 12.3**
  it('Property 11: invalid stepTrail inputs return the same state object, teleported false, and never throw', () => {
    const quarter = fc.integer({ min: -2000, max: 2000 }).map((n) => n / 4);
    const walkPts = fc.array(fc.record({ x: quarter, y: quarter }), { minLength: 1, maxLength: 20 });
    // Valid trail from a short pixel-scale walk.
    const stateArb = walkPts.map((walk) => {
      let s = createTrail(walk[0]);
      for (let i = 1; i < walk.length; i++) s = appendSample(s, walk[i]);
      return s;
    });
    const validParams = fc.record({
      followDistance: fc.integer({ min: 0, max: 120 }),
      deltaMs: fc.integer({ min: 0, max: 200 }),
      speed: fc.integer({ min: 0, max: 300 }),
    });
    const badNumber = fc.oneof(
      fc.constant(NaN),
      fc.constant(Infinity),
      fc.constant(-Infinity),
      fc.double({ min: -1000, max: -1e-6, noNaN: true }),
      fc.integer({ min: -1000, max: -1 }),
    );
    const validPlayer = fc.record({ x: quarter, y: quarter });

    // Bad params: at least one of the three fields is replaced by a bad number.
    const badParamsCase = fc
      .tuple(
        validParams,
        fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()).filter(([a, b, c]) => a || b || c),
        fc.tuple(badNumber, badNumber, badNumber),
        validPlayer,
      )
      .map(([params, [a, b, c], [ba, bb, bc], player]) => ({
        params: {
          followDistance: a ? ba : params.followDistance,
          deltaMs: b ? bb : params.deltaMs,
          speed: c ? bc : params.speed,
        },
        player,
      }));

    // Bad player: non-finite coordinate, or null / undefined.
    const nonFinite = fc.constantFrom(NaN, Infinity, -Infinity);
    const badPlayerCase = fc.tuple(
      validParams,
      fc.oneof(
        fc.record({ x: nonFinite, y: quarter }),
        fc.record({ x: quarter, y: nonFinite }),
        fc.record({ x: nonFinite, y: nonFinite }),
        fc.constant(null),
        fc.constant(undefined),
      ),
    ).map(([params, player]) => ({ params, player }));

    fc.assert(
      fc.property(stateArb, fc.oneof(badParamsCase, badPlayerCase), (state, { params, player }) => {
        const snapshot = JSON.stringify(state);
        let res;
        expect(() => {
          res = stepTrail(state, player, params);
        }).not.toThrow();
        expect(res.state).toBe(state);
        expect(res.teleported).toBe(false);
        expect(JSON.stringify(state)).toBe(snapshot);
        expect(isValidStepInput(params.followDistance, params.deltaMs, params.speed, player)).toBe(false);
      }),
      { numRuns: 200 },
    );

    // Valid inputs are accepted by the predicate.
    fc.assert(
      fc.property(validParams, validPlayer, (params, player) => {
        expect(isValidStepInput(params.followDistance, params.deltaMs, params.speed, player)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('example: equal position is a no-op, differing position appends', () => {
    const s0 = createTrail({ x: 1, y: 1 });
    expect(appendSample(s0, { x: 1, y: 1 })).toBe(s0);
    const s1 = appendSample(s0, { x: 4, y: 5 });
    expect(s1.samples).toEqual([{ x: 1, y: 1 }, { x: 4, y: 5 }]);
    expect(s1.gap).toBe(5);
  });

  it('example: cap of 2 evicts the oldest sample', () => {
    let s = createTrail({ x: 0, y: 0 });
    s = appendSample(s, { x: 1, y: 0 }, 2);
    s = appendSample(s, { x: 2, y: 0 }, 2);
    expect(s.samples).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(s.gap).toBeLessThanOrEqual(pathLength(s.samples));
  });
});
