import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('phaser', () => ({}));

import FollowerController from '../FollowerController.js';
import { MAX_FRAME_DELTA_MS, clampPoint, shouldSettle } from '../followerTrail.js';
import { chooseSettleTarget, sanitizeBoxes, rectsOverlap, isValidPosition, segmentClear } from '../followerCollision.js';

const SPEED = 80;
const WALK_FRAME_MS = 16;
const PHYS_STEP_PX = 2;

// ---------------------------------------------------------------------------
// Helpers (shared with later FollowerController property tasks)
// ---------------------------------------------------------------------------

/** Build a controller with a recording mock scene/sprite and an isolated bus. */
function makeController({ start, facing = 'down', bounds, boxes = [], speed = SPEED } = {}) {
  const sprite = {
    x: start.x,
    y: start.y,
    texture: { key: 'follower' },
    positions: [],
    setPosition: vi.fn(function (x, y) {
      this.x = x;
      this.y = y;
      this.positions.push({ x, y });
    }),
    setFrame: vi.fn(),
    destroy: vi.fn(),
    anims: { play: vi.fn() },
  };
  const scene = {
    anims: {
      create: vi.fn(),
      exists: vi.fn(() => false),
      generateFrameNumbers: vi.fn(() => []),
    },
  };
  const eventBus = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
  const controller = new FollowerController(scene, sprite, eventBus, {
    speed,
    initialFacing: facing,
    startPosition: { ...start },
    getCollisionBoxes: () => boxes,
  });
  if (bounds) {
    controller.setBounds(bounds.minX, bounds.maxX);
    controller.setVerticalBounds(bounds.minY, bounds.maxY);
  }
  return { controller, sprite, scene, eventBus };
}

// Reserved for tasks 6.9–6.11.
const facingArb = fc.constantFrom('up', 'down', 'left', 'right');
const frameDelta = fc.integer({ min: 0, max: 200 });

/** Walk out 30-80 px, reverse 0-40 px, stop facing the reversal direction. */
const doubleBackWalk = fc.record({
  start: fc.record({ x: fc.integer({ min: 200, max: 400 }), y: fc.integer({ min: 100, max: 200 }) }),
  dir: fc.constantFrom(1, -1),
  out: fc.integer({ min: 30, max: 80 }),
  back: fc.integer({ min: 0, max: 40 }),
});

/** Integer bounds enclosing the walk, with a 0-60 px margin per side. */
const boundsNearPlayer = fc.record({
  left: fc.integer({ min: 0, max: 60 }),
  right: fc.integer({ min: 0, max: 60 }),
  up: fc.integer({ min: 0, max: 60 }),
  down: fc.integer({ min: 0, max: 60 }),
});

/** Player positions per physical step for a double-back walk. */
function walkPositions({ start, dir, out, back }) {
  const pts = [];
  let x = start.x;
  const advance = (dist, d) => {
    for (let moved = 0; moved < dist; moved += PHYS_STEP_PX) {
      x += d * Math.min(PHYS_STEP_PX, dist - moved);
      pts.push({ x, y: start.y });
    }
  };
  advance(out, dir);
  advance(back, -dir);
  return pts;
}

describe('FollowerController settle (property tests)', () => {
  // Feature: follower-companion, Property 19: Settle step speed, snap, rounding and clamp (frame part)
  // **Validates: Requirements 13.2, 13.3, 13.10, 4.6**
  it('Property 19: each Settling frame moves <= speed*min(dt,100)/1000 + 1px, with integer in-bounds sprite', () => {
    let settlingFramesSeen = 0;

    fc.assert(
      fc.property(
        doubleBackWalk,
        boundsNearPlayer,
        fc.array(frameDelta, { minLength: 1, maxLength: 40 }),
        (walk, margins, stopDeltas) => {
          const path = walkPositions(walk);
          const xs = [walk.start.x, ...path.map((p) => p.x)];
          const bounds = {
            minX: Math.min(...xs) - margins.left,
            maxX: Math.max(...xs) + margins.right,
            minY: walk.start.y - margins.up,
            maxY: walk.start.y + margins.down,
          };
          // Facing = the reversal direction (or the outward one if no reversal).
          const moveDir = walk.back > 0 ? -walk.dir : walk.dir;
          const facing = moveDir > 0 ? 'right' : 'left';

          const { controller, sprite } = makeController({
            start: walk.start,
            facing,
            bounds,
          });
          const player = { x: walk.start.x, y: walk.start.y };

          for (const p of path) {
            player.x = p.x;
            player.y = p.y;
            controller.update(player, WALK_FRAME_MS, facing);
          }

          for (const dt of stopDeltas) {
            const modeBefore = controller.mode;
            const before = { ...controller._pos };
            controller.update(player, dt, facing);
            const after = controller._pos;

            if (modeBefore === 'settling' || controller.mode === 'settling') {
              settlingFramesSeen += 1;
              const disp = Math.hypot(after.x - before.x, after.y - before.y);
              const limit = (SPEED * Math.min(dt, MAX_FRAME_DELTA_MS)) / 1000 + 1;
              expect(disp).toBeLessThanOrEqual(limit + 1e-9);

              expect(Number.isInteger(sprite.x)).toBe(true);
              expect(Number.isInteger(sprite.y)).toBe(true);
              expect(sprite.x).toBeGreaterThanOrEqual(bounds.minX);
              expect(sprite.x).toBeLessThanOrEqual(bounds.maxX);
              expect(sprite.y).toBeGreaterThanOrEqual(bounds.minY);
              expect(sprite.y).toBeLessThanOrEqual(bounds.maxY);
            }
          }
        },
      ),
      { numRuns: 200 },
    );

    // Sanity: the generator actually exercises Settling at least once.
    expect(settlingFramesSeen).toBeGreaterThan(0);
  });

  // Feature: follower-companion, Property 20: Settle separation
  // **Validates: Requirements 13.11, 13.5, 13.3, 13.6**
  it('Property 20: after a long stop the Follower is >= 16px from the Player, or no target existed and it held still', () => {
    let settledRuns = 0;
    let nullTargetRuns = 0;

    const boxArb = fc.record({
      dx: fc.integer({ min: -40, max: 40 }),
      dy: fc.integer({ min: -50, max: 50 }),
      width: fc.integer({ min: 4, max: 24 }),
      height: fc.integer({ min: 4, max: 24 }),
    });

    fc.assert(
      fc.property(
        doubleBackWalk,
        boundsNearPlayer,
        fc.array(boxArb, { minLength: 0, maxLength: 6 }),
        facingArb,
        fc.array(fc.integer({ min: 16, max: 33 }), { minLength: 50, maxLength: 70 }),
        (walk, margins, boxSpecs, _unusedFacing, stopDeltas) => {
          const path = walkPositions(walk);
          const xs = [walk.start.x, ...path.map((p) => p.x)];
          const bounds = {
            minX: Math.min(...xs) - margins.left,
            maxX: Math.max(...xs) + margins.right,
            minY: walk.start.y - margins.up,
            maxY: walk.start.y + margins.down,
          };
          const moveDir = walk.back > 0 ? -walk.dir : walk.dir;
          const facing = moveDir > 0 ? 'right' : 'left';
          const stop = path.length > 0 ? path[path.length - 1] : walk.start;

          // Boxes sit around the stop point but never on the walk band itself,
          // so the Follower never starts overlapping one.
          const band = {
            x: Math.min(...xs) - 10,
            y: walk.start.y - 17,
            width: Math.max(...xs) - Math.min(...xs) + 20,
            height: 18,
          };
          const boxes = boxSpecs.map((b) => ({
            x: stop.x + b.dx,
            y: stop.y + b.dy,
            width: b.width,
            height: b.height,
          }));
          fc.pre(boxes.every((b) => !rectsOverlap(b, band)));

          const { controller, sprite } = makeController({
            start: walk.start,
            facing,
            bounds,
            boxes,
          });

          // Record the settle decision (the only place boxes are queried).
          let decision = null;
          let arrivalChecked = false;
          controller.getCollisionBoxes = () => {
            decision = {
              followerPos: { ...controller._pos },
              spriteAtDecision: { x: sprite.x, y: sprite.y },
            };
            return boxes;
          };

          const player = { x: walk.start.x, y: walk.start.y };
          for (const p of path) {
            player.x = p.x;
            player.y = p.y;
            controller.update(player, WALK_FRAME_MS, facing);
          }
          const playerFeet = { x: player.x, y: player.y };

          let target = null;
          for (const dt of stopDeltas) {
            controller.update(player, dt, facing);

            if (decision && !('oracle' in decision)) {
              decision.oracle = chooseSettleTarget(
                playerFeet,
                facing,
                24,
                bounds,
                sanitizeBoxes(boxes),
                decision.followerPos,
              );
              target = decision.oracle;
            }

            // Arrival: trail is exactly [target, playerFeet] (or one sample).
            if (decision && target && !arrivalChecked && controller.mode === 'following' && !controller._settleBlocked) {
              arrivalChecked = true;
              expect(controller._pos).toEqual(target);
              const coincident = target.x === playerFeet.x && target.y === playerFeet.y;
              expect(controller.trail.samples).toEqual(
                coincident ? [playerFeet] : [target, playerFeet],
              );
            }
          }

          const dist = Math.hypot(sprite.x - playerFeet.x, sprite.y - playerFeet.y);
          if (decision && !target) {
            nullTargetRuns += 1;
            // No valid candidate: Follower held its position after the decision.
            expect(sprite.x).toBe(decision.spriteAtDecision.x);
            expect(sprite.y).toBe(decision.spriteAtDecision.y);
          } else {
            if (decision) settledRuns += 1;
            expect(dist).toBeGreaterThanOrEqual(16 - 0.71);
          }
          if (decision && target) {
            expect(arrivalChecked).toBe(true);
            expect(isValidPosition({ x: sprite.x, y: sprite.y }, boxes, bounds)).toBe(true);
          }
        },
      ),
      { numRuns: 150 },
    );

    expect(settledRuns).toBeGreaterThan(0);
    expect(nullTargetRuns).toBeGreaterThanOrEqual(0);
  });

  // Feature: follower-companion, Property 21: Cancel continuity
  // **Validates: Requirements 13.7, 13.6**
  it('Property 21: moving the Player while Settling cancels with 0px jump and reseeds the trail; >64px teleports', () => {
    let cancelsSeen = 0;
    let teleportsSeen = 0;

    /** Walk, stop, then idle until Settling. Returns null if it never settles. */
    function driveToSettling(walk, margins, extraStops) {
      const path = walkPositions(walk);
      const xs = [walk.start.x, ...path.map((p) => p.x)];
      const bounds = {
        minX: Math.min(...xs) - margins.left,
        maxX: Math.max(...xs) + margins.right,
        minY: walk.start.y - margins.up,
        maxY: walk.start.y + margins.down,
      };
      const moveDir = walk.back > 0 ? -walk.dir : walk.dir;
      const facing = moveDir > 0 ? 'right' : 'left';
      const ctx = makeController({ start: walk.start, facing, bounds });
      const player = { x: walk.start.x, y: walk.start.y };
      for (const p of path) {
        player.x = p.x;
        player.y = p.y;
        ctx.controller.update(player, WALK_FRAME_MS, facing);
      }
      for (let i = 0; i < 4 + extraStops && ctx.controller.mode !== 'settling'; i += 1) {
        ctx.controller.update(player, WALK_FRAME_MS, facing);
      }
      if (ctx.controller.mode !== 'settling') return null;
      return { ...ctx, player, facing, bounds };
    }

    const moveArb = fc.record({
      angle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
      dist: fc.oneof(
        fc.double({ min: 0.01, max: 4, noNaN: true }),
        fc.double({ min: 0.01, max: 63.9, noNaN: true }),
      ),
    });

    fc.assert(
      fc.property(
        doubleBackWalk,
        boundsNearPlayer,
        fc.integer({ min: 0, max: 20 }),
        moveArb,
        fc.array(fc.double({ min: 0.5, max: 2, noNaN: true }), { minLength: 1, maxLength: 30 }),
        (walk, margins, extraStops, move, awaySteps) => {
          const ctx = driveToSettling(walk, margins, extraStops);
          fc.pre(ctx !== null);
          const { controller, sprite, player, facing } = ctx;
          cancelsSeen += 1;

          const posBefore = { ...controller._pos };
          const spriteBefore = { x: sprite.x, y: sprite.y };

          player.x += Math.cos(move.angle) * move.dist;
          player.y += Math.sin(move.angle) * move.dist;
          fc.pre(Number.isFinite(player.x) && Number.isFinite(player.y));
          controller.update(player, WALK_FRAME_MS, facing);

          // Zero jump.
          expect(controller._pos).toEqual(posBefore);
          expect({ x: sprite.x, y: sprite.y }).toEqual(spriteBefore);
          expect(controller.mode).toBe('following');

          // Trail is exactly [followerPos, playerFeet].
          const feet = { x: player.x, y: player.y };
          const gap = Math.hypot(feet.x - posBefore.x, feet.y - posBefore.y);
          const samples = controller.trail.samples;
          if (gap === 0) {
            expect(samples).toEqual([feet]);
            expect(controller.trail.gap).toBe(0);
          } else {
            expect(samples).toEqual([posBefore, feet]);
            expect(controller.trail.gap).toBeCloseTo(gap, 9);
          }

          // Following resumes: no movement while gap <= follow distance.
          const dirLen = gap || 1;
          const ux = gap === 0 ? 1 : (feet.x - posBefore.x) / dirLen;
          const uy = gap === 0 ? 0 : (feet.y - posBefore.y) / dirLen;
          for (const s of awaySteps) {
            // Gap after appending this step, before Following advances.
            const appendedGap = controller.trail.gap + s;
            if (appendedGap > 24 - 1e-9) break; // gap exceeds follow distance: may move now
            player.x += ux * s;
            player.y += uy * s;
            const before = { ...controller._pos };
            controller.update(player, WALK_FRAME_MS, facing);
            expect(controller._pos).toEqual(before);
            expect({ x: sprite.x, y: sprite.y }).toEqual(spriteBefore);
          }
        },
      ),
      { numRuns: 100 },
    );
    expect(cancelsSeen).toBeGreaterThan(0);

    // Teleport case (C19): > 64px wins over cancel.
    fc.assert(
      fc.property(
        doubleBackWalk,
        boundsNearPlayer,
        fc.integer({ min: 0, max: 20 }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 64.5, max: 300, noNaN: true }),
        (walk, margins, extraStops, angle, dist) => {
          const ctx = driveToSettling(walk, margins, extraStops);
          fc.pre(ctx !== null);
          const { controller, sprite, player, facing, bounds } = ctx;
          teleportsSeen += 1;

          player.x += Math.cos(angle) * dist;
          player.y += Math.sin(angle) * dist;
          controller.update(player, WALK_FRAME_MS, facing);

          const expected = clampPoint({ x: player.x, y: player.y }, {
            minX: bounds.minX,
            maxX: bounds.maxX,
            minY: bounds.minY,
            maxY: bounds.maxY,
          });
          expect(controller.mode).toBe('following');
          expect(controller.trail.samples).toEqual([{ x: player.x, y: player.y }]);
          expect(controller.trail.gap).toBe(0);
          expect(controller._pos).toEqual(expected);
          expect(sprite.x).toBe(Math.round(expected.x));
          expect(sprite.y).toBe(Math.round(expected.y));
        },
      ),
      { numRuns: 100 },
    );
    expect(teleportsSeen).toBeGreaterThan(0);
  });

  // Feature: follower-companion, Property 22: No settling while moving or frozen
  // **Validates: Requirements 13.8, 13.9, 13.12**
  it('Property 22: no Settling on moving frames; frozen updates are no-ops; settling starts when conditions hold; far stops stay still', () => {
    let frozenFrames = 0;
    let movedFrames = 0;
    let settlesAfterStop = 0;

    const opArb = fc.oneof(
      { weight: 4, arbitrary: fc.record({
          kind: fc.constant('move'),
          angle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
          step: fc.double({ min: 0.5, max: 2, noNaN: true }),
          dt: fc.integer({ min: 16, max: 33 }),
        }) },
      { weight: 5, arbitrary: fc.record({ kind: fc.constant('stop'), dt: fc.integer({ min: 16, max: 33 }) }) },
      { weight: 1, arbitrary: fc.record({ kind: fc.constant('freeze'), dt: fc.integer({ min: 16, max: 33 }) }) },
      { weight: 2, arbitrary: fc.record({ kind: fc.constant('unfreeze'), dt: fc.integer({ min: 16, max: 33 }) }) },
    );

    // (a), (b), (c) — unbounded world, no collision boxes.
    fc.assert(
      fc.property(doubleBackWalk, fc.array(opArb, { minLength: 20, maxLength: 120 }), (walk, ops) => {
        const moveDir = walk.back > 0 ? -walk.dir : walk.dir;
        const facing = moveDir > 0 ? 'right' : 'left';
        const { controller } = makeController({ start: walk.start, facing });
        const player = { x: walk.start.x, y: walk.start.y };
        for (const p of walkPositions(walk)) {
          player.x = p.x;
          player.y = p.y;
          controller.update(player, WALK_FRAME_MS, facing);
        }

        for (const op of ops) {
          if (op.kind === 'freeze') controller.freeze();
          if (op.kind === 'unfreeze') controller.unfreeze();

          const prev = { x: player.x, y: player.y };
          if (op.kind === 'move') {
            player.x += Math.cos(op.angle) * op.step;
            player.y += Math.sin(op.angle) * op.step;
          }
          const moved = player.x !== prev.x || player.y !== prev.y;

          const wasFrozen = controller.isFrozen;
          const modeBefore = controller.mode;
          const posBefore = { ...controller._pos };
          const targetBefore = controller.settleTarget;
          const trailBefore = controller.trail;
          const samples = trailBefore.samples;
          const newest = samples.length > 0 ? samples[samples.length - 1] : null;
          const stopped = newest !== null && newest.x === player.x && newest.y === player.y;

          controller.update(player, op.dt, facing);

          if (wasFrozen) {
            frozenFrames += 1;
            // (b)
            expect(controller._pos).toEqual(posBefore);
            expect(controller.mode).toBe(modeBefore);
            expect(controller.settleTarget).toBe(targetBefore);
            expect(controller.trail).toBe(trailBefore);
            continue;
          }

          // (a)
          if (moved) {
            movedFrames += 1;
            expect(controller.mode).not.toBe('settling');
          }

          // (c) Property 18 conditions hold on the resulting state but no settle began.
          if (stopped && modeBefore === 'following' && controller.mode === 'following' && !controller._settleBlocked) {
            const would = shouldSettle({
              playerStopped: true,
              gap: controller.trail.gap,
              followDistance: 24,
              followerPos: controller._pos,
              playerPos: { x: player.x, y: player.y },
              minSeparation: 16,
            });
            expect(would).toBe(false);
          }
          if (stopped && modeBefore === 'following' && controller.mode === 'settling') settlesAfterStop += 1;
        }
      }),
      { numRuns: 150 },
    );
    expect(frozenFrames).toBeGreaterThan(0);
    expect(movedFrames).toBeGreaterThan(0);
    expect(settlesAfterStop).toBeGreaterThan(0);

    // (d) Already >= 16 px away after following finishes: no movement while stopped.
    fc.assert(
      fc.property(
        fc.record({ x: fc.integer({ min: 200, max: 400 }), y: fc.integer({ min: 100, max: 200 }) }),
        fc.constantFrom(1, -1),
        fc.integer({ min: 100, max: 200 }),
        fc.array(fc.integer({ min: 16, max: 33 }), { minLength: 30, maxLength: 60 }),
        (start, dir, length, stopDeltas) => {
          const facing = dir > 0 ? 'right' : 'left';
          const { controller } = makeController({ start, facing });
          const player = { x: start.x, y: start.y };
          for (let moved = 0; moved < length; moved += PHYS_STEP_PX) {
            player.x += dir * PHYS_STEP_PX;
            controller.update(player, WALK_FRAME_MS, facing);
          }
          // Let Following finish.
          // The Follower is speed-capped and may lag the Player; run until it stops moving.
          for (let i = 0; i < 400; i += 1) {
            const before = { ...controller._pos };
            controller.update(player, WALK_FRAME_MS, facing);
            if (controller._pos.x === before.x && controller._pos.y === before.y) break;
          }
          const settled = { ...controller._pos };
          const d = Math.hypot(settled.x - player.x, settled.y - player.y);
          fc.pre(d >= 16);
          for (const dt of stopDeltas) {
            controller.update(player, dt, facing);
            expect(controller.mode).toBe('following');
            expect(controller._pos).toEqual(settled);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: follower-companion, Property 26: Settle steps stay valid and the route is clear
  // **Validates: Requirements 13.5, 13.13, 13.14, 13.16, 13.18**
  it('Property 26: every Settling step is valid, the route is clear, boxes are queried once, and a throwing query holds', () => {
    let settledRuns = 0;
    let blockedRuns = 0;
    let throwingRuns = 0;

    const boxArb = fc.record({
      dx: fc.integer({ min: -40, max: 40 }),
      dy: fc.integer({ min: -50, max: 50 }),
      width: fc.integer({ min: 4, max: 24 }),
      height: fc.integer({ min: 4, max: 24 }),
    });

    /** Walk, then idle on the stop point; returns everything needed for assertions. */
    function setup(walk, margins, boxes, throwing) {
      const path = walkPositions(walk);
      const xs = [walk.start.x, ...path.map((p) => p.x)];
      const bounds = {
        minX: Math.min(...xs) - margins.left,
        maxX: Math.max(...xs) + margins.right,
        minY: walk.start.y - margins.up,
        maxY: walk.start.y + margins.down,
      };
      const moveDir = walk.back > 0 ? -walk.dir : walk.dir;
      const facing = moveDir > 0 ? 'right' : 'left';
      const ctx = makeController({ start: walk.start, facing, bounds });
      const spy = vi.fn(() => {
        spy.decisionPos = { ...ctx.controller._pos };
        if (throwing) throw new Error('box query failed');
        return boxes;
      });
      ctx.controller.getCollisionBoxes = spy;
      const player = { x: walk.start.x, y: walk.start.y };
      for (const p of path) {
        player.x = p.x;
        player.y = p.y;
        ctx.controller.update(player, WALK_FRAME_MS, facing);
      }
      return { ...ctx, spy, player, facing, bounds, xs, path };
    }

    fc.assert(
      fc.property(
        doubleBackWalk,
        boundsNearPlayer,
        fc.array(boxArb, { minLength: 0, maxLength: 8 }),
        fc.array(fc.integer({ min: 16, max: 33 }), { minLength: 50, maxLength: 70 }),
        (walk, margins, boxSpecs, stopDeltas) => {
          const path = walkPositions(walk);
          const xs = [walk.start.x, ...path.map((p) => p.x)];
          const stop = path[path.length - 1];
          // Keep boxes off the walk band so the Follower never starts inside one.
          const band = {
            x: Math.min(...xs) - 10,
            y: walk.start.y - 17,
            width: Math.max(...xs) - Math.min(...xs) + 20,
            height: 18,
          };
          const boxes = boxSpecs.map((b) => ({
            x: stop.x + b.dx,
            y: stop.y + b.dy,
            width: b.width,
            height: b.height,
          }));
          fc.pre(boxes.every((b) => !rectsOverlap(b, band)));

          const { controller, sprite, spy, player, facing, bounds } = setup(walk, margins, boxes, false);
          expect(spy).not.toHaveBeenCalled(); // never queried while the Player moves
          const playerFeet = { x: player.x, y: player.y };
          const clean = sanitizeBoxes(boxes);
          let queried = false;

          for (const dt of stopDeltas) {
            const posBefore = { x: sprite.x, y: sprite.y };
            const wasSettling = controller.mode === 'settling';
            controller.update(player, dt, facing);

            const decidedThisFrame = !queried && spy.mock.calls.length > 0;
            if (spy.mock.calls.length > 0) queried = true;
            // Every placed position passes validity against the snapshot (13.13).
            if (queried && (wasSettling || controller.mode === 'settling')) {
              expect(isValidPosition({ x: sprite.x, y: sprite.y }, clean, bounds)).toBe(true);
            }
            if (controller._settleBlocked && !decidedThisFrame) {
              // Held: no settle walk after the decision failed (13.5); Following may
              // only creep inside the 1px gap tolerance.
              expect(controller.mode).toBe('following');
              expect(Math.hypot(sprite.x - posBefore.x, sprite.y - posBefore.y)).toBeLessThanOrEqual(2);
            }
          }

          // Exactly one snapshot per stop, however many stopped frames pass (13.16).
          expect(spy.mock.calls.length).toBeLessThanOrEqual(1);

          if (spy.mock.calls.length === 1) {
            // The Follower's position at the moment of the decision (the only query).
            const followerAtStop = spy.decisionPos;
            const oracle = chooseSettleTarget(playerFeet, facing, 24, bounds, clean, followerAtStop);
            if (oracle) {
              settledRuns += 1;
              // The route to the chosen target was clear of every box (13.14).
              expect(segmentClear(followerAtStop, oracle, clean)).toBe(true);
              expect(isValidPosition(oracle, clean, bounds)).toBe(true);
            } else {
              blockedRuns += 1;
              expect(
                Math.hypot(sprite.x - followerAtStop.x, sprite.y - followerAtStop.y),
              ).toBeLessThanOrEqual(2);
              expect(controller.mode).toBe('following');
            }
          }
        },
      ),
      { numRuns: 150 },
    );
    expect(settledRuns).toBeGreaterThan(0);
    expect(blockedRuns).toBeGreaterThanOrEqual(0);

    // Throwing query (13.18): no throw, Follower holds, queried once, latch clears on move.
    fc.assert(
      fc.property(
        doubleBackWalk,
        boundsNearPlayer,
        fc.array(fc.integer({ min: 16, max: 33 }), { minLength: 20, maxLength: 40 }),
        (walk, margins, stopDeltas) => {
          const { controller, sprite, spy, player, facing } = setup(walk, margins, [], true);
          // Position right after the failed decision; Following may still catch up before it.
          let held = null;
          let heldSprite = null;

          for (const dt of stopDeltas) {
            expect(() => controller.update(player, dt, facing)).not.toThrow();
            expect(controller.mode).toBe('following');
            if (spy.mock.calls.length > 0 && held === null) {
              held = { ...controller._pos };
              heldSprite = { x: sprite.x, y: sprite.y };
            }
          }
          if (held !== null) {
            throwingRuns += 1;
            expect(spy.mock.calls.length).toBe(1);
            expect(controller._settleBlocked).toBe(true);
            // Held: only Following's final creep inside the 1px gap tolerance, no settle walk.
            expect(Math.hypot(sprite.x - heldSprite.x, sprite.y - heldSprite.y)).toBeLessThanOrEqual(2);
            expect(Math.hypot(controller._pos.x - held.x, controller._pos.y - held.y)).toBeLessThanOrEqual(1 + 1e-9);

            // A Player move clears the latch.
            player.x += 1;
            controller.update(player, WALK_FRAME_MS, facing);
            expect(controller._settleBlocked).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
    expect(throwingRuns).toBeGreaterThan(0);
  });
});
