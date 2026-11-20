import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';

vi.mock('phaser', () => ({}));

import FollowerController from '../FollowerController.js';
import eventBus from '../EventBus.js';

// ---------------------------------------------------------------------------
// Helpers (shared by later properties in this file)
// ---------------------------------------------------------------------------

function createMockScene() {
  return {
    anims: {
      exists: vi.fn().mockReturnValue(false),
      create: vi.fn(),
      generateFrameNumbers: vi.fn((key, config) => {
        const frames = [];
        for (let i = config.start; i <= config.end; i++) frames.push({ key, frame: i });
        return frames;
      }),
    },
  };
}

function createMockSprite(x = 0, y = 0) {
  const sprite = {
    x,
    y,
    texture: { key: 'follower' },
    setPosition: vi.fn((nx, ny) => {
      sprite.x = nx;
      sprite.y = ny;
    }),
    setFrame: vi.fn(),
    destroy: vi.fn(),
    anims: { play: vi.fn() },
  };
  return sprite;
}

const created = [];

function makeController(options = {}) {
  const start = options.startPosition || { x: 100, y: 100 };
  const sprite = createMockSprite(start.x, start.y);
  const controller = new FollowerController(createMockScene(), sprite, eventBus, {
    startPosition: start,
    ...options,
  });
  created.push(controller);
  return { controller, sprite };
}

afterEach(() => {
  while (created.length) created.pop().destroy();
});

const finiteCoord = fc.integer({ min: -500, max: 500 });
const validWalk = fc.array(
  fc.record({ x: finiteCoord, y: finiteCoord, dt: fc.integer({ min: 1, max: 50 }) }),
  { minLength: 0, maxLength: 10 },
);
const facingArb = fc.constantFrom('up', 'down', 'left', 'right');
const badDelta = fc.constantFrom(-1, -16, -0.001, NaN, Infinity, -Infinity);
const badCoord = fc.constantFrom(NaN, Infinity, -Infinity);

function walk(controller, steps) {
  for (const s of steps) controller.update({ x: s.x, y: s.y }, s.dt, 'down');
}

function snapshot(controller, sprite) {
  return {
    calls: sprite.setPosition.mock.calls.length,
    x: sprite.x,
    y: sprite.y,
    mode: controller.mode,
    trail: controller.trail,
    trailCopy: JSON.parse(JSON.stringify(controller.trail)),
  };
}

function expectUnchanged(controller, sprite, before) {
  expect(sprite.setPosition.mock.calls.length).toBe(before.calls);
  expect(sprite.x).toBe(before.x);
  expect(sprite.y).toBe(before.y);
  expect(controller.mode).toBe(before.mode);
  expect(controller.trail).toBe(before.trail);
  expect(JSON.parse(JSON.stringify(controller.trail))).toEqual(before.trailCopy);
}

describe('FollowerController properties', () => {
  // Feature: follower-companion, Property 15: Freeze state machine
  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.7**
  describe('Property 15: Freeze state machine', () => {
    const command = fc.oneof(
      fc.constant({ type: 'activate' }),
      fc.constant({ type: 'dismiss-dialogue' }),
      fc.constant({ type: 'dismiss-image' }),
      fc.record({
        type: fc.constant('move'),
        dx: fc.integer({ min: -2, max: 2 }),
        dy: fc.integer({ min: -2, max: 2 }),
      }),
      fc.constant({ type: 'stop' }),
    );

    it('isFrozen follows the model; frozen updates change nothing; controller emits nothing', () => {
      fc.assert(
        fc.property(fc.array(command, { minLength: 1, maxLength: 60 }), (script) => {
          const { controller, sprite } = makeController({ startPosition: { x: 100, y: 100 } });
          const emitSpy = vi.spyOn(eventBus, 'emit');
          try {
            let model = false;
            let scriptEmits = 0;
            let posBeforeFreeze = null;
            const player = { x: 100, y: 100 };
            const dt = 25;

            for (const cmd of script) {
              if (cmd.type === 'activate' || cmd.type === 'dismiss-dialogue' || cmd.type === 'dismiss-image') {
                const wasFrozen = model;
                const name =
                  cmd.type === 'activate'
                    ? 'hotspot-activated'
                    : cmd.type === 'dismiss-dialogue'
                      ? 'dialogue-dismissed'
                      : 'image-dismissed';
                if (cmd.type === 'activate') {
                  if (!wasFrozen) posBeforeFreeze = { x: sprite.x, y: sprite.y };
                  model = true;
                } else {
                  model = false;
                }
                eventBus.emit(name, {});
                scriptEmits++;
                if (wasFrozen && !model) {
                  expect({ x: sprite.x, y: sprite.y }).toEqual(posBeforeFreeze);
                }
              } else {
                if (cmd.type === 'move') {
                  player.x += cmd.dx;
                  player.y += cmd.dy;
                }
                const before = model ? snapshot(controller, sprite) : null;
                const playCallsBefore = sprite.anims.play.mock.calls.length;
                controller.update({ x: player.x, y: player.y }, dt, 'down');
                if (model) {
                  expectUnchanged(controller, sprite, before);
                  expect(sprite.anims.play.mock.calls.length).toBe(playCallsBefore);
                }
              }
              expect(controller.isFrozen).toBe(model);
            }

            // Only the script's own emits reached the bus.
            expect(emitSpy.mock.calls.length).toBe(scriptEmits);
          } finally {
            emitSpy.mockRestore();
            controller.destroy();
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: follower-companion, Property 16: Whole-pixel sprite placement
  // **Validates: Requirements 9.1, 8.1, 13.10**
  describe('Property 16: Whole-pixel sprite placement', () => {
    const delta = fc.oneof(
      fc.integer({ min: -40, max: 40 }).map((q) => q / 4),
      fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
    );
    const segment = fc.record({
      dx: delta,
      dy: delta,
      dt: fc.integer({ min: 1, max: 100 }),
      moveFrames: fc.integer({ min: 1, max: 6 }),
      stopFrames: fc.integer({ min: 0, max: 40 }),
      facing: facingArb,
    });
    const scenario = fc.record({
      minX: fc.integer({ min: -200, max: 0 }),
      spanX: fc.integer({ min: 0, max: 300 }),
      minY: fc.integer({ min: -200, max: 0 }),
      spanY: fc.integer({ min: 0, max: 300 }),
      fx: fc.double({ min: 0, max: 1, noNaN: true }),
      fy: fc.double({ min: 0, max: 1, noNaN: true }),
      segments: fc.array(segment, { minLength: 1, maxLength: 12 }),
    });

    let settlingRuns = 0;

    it('sprite is integer, within 0.5px of the unrounded position, and inside bounds', () => {
      fc.assert(
        fc.property(scenario, (sc) => {
          const minX = sc.minX;
          const maxX = sc.minX + sc.spanX;
          const minY = sc.minY;
          const maxY = sc.minY + sc.spanY;
          const start = {
            x: minX + sc.fx * sc.spanX,
            y: minY + sc.fy * sc.spanY,
          };
          const { controller, sprite } = makeController({ startPosition: { ...start } });
          controller.setBounds(minX, maxX);
          controller.setVerticalBounds(minY, maxY);
          const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
          const player = { ...start };
          let sawSettling = false;

          const check = () => {
            const { x, y } = sprite;
            const ok =
              Number.isInteger(x) &&
              Number.isInteger(y) &&
              Math.abs(x - controller._pos.x) <= 0.5 + 1e-9 &&
              Math.abs(y - controller._pos.y) <= 0.5 + 1e-9 &&
              x >= minX && x <= maxX && y >= minY && y <= maxY;
            if (!ok) {
              expect({ x, y, pos: { ...controller._pos }, mode: controller.mode, bounds: [minX, maxX, minY, maxY] }).toBe('whole-pixel placement within bounds');
            }
            if (controller.mode === 'settling') sawSettling = true;
          };

          for (const seg of sc.segments) {
            for (let i = 0; i < seg.moveFrames; i++) {
              player.x = clamp(player.x + seg.dx, minX, maxX);
              player.y = clamp(player.y + seg.dy, minY, maxY);
              controller.update({ x: player.x, y: player.y }, seg.dt, seg.facing);
              check();
            }
            for (let i = 0; i < seg.stopFrames; i++) {
              controller.update({ x: player.x, y: player.y }, seg.dt, seg.facing);
              check();
            }
          }
          if (sawSettling) settlingRuns++;
          controller.destroy();
        }),
        { numRuns: 200 },
      );
      expect(settlingRuns).toBeGreaterThan(0);
    });
  });

  // Feature: follower-companion, Property 11: Invalid inputs are a no-op
  // **Validates: Requirements 12.3**
  describe('Property 11: Invalid inputs are a no-op', () => {
    it('invalid deltaMs leaves position, trail and mode unchanged', () => {
      fc.assert(
        fc.property(validWalk, finiteCoord, finiteCoord, badDelta, facingArb, (steps, px, py, dt, facing) => {
          const { controller, sprite } = makeController();
          walk(controller, steps);
          const before = snapshot(controller, sprite);
          expect(() => controller.update({ x: px, y: py }, dt, facing)).not.toThrow();
          expectUnchanged(controller, sprite, before);
          controller.destroy();
        }),
        { numRuns: 100 },
      );
    });

    it('non-finite player coordinates leave state unchanged', () => {
      fc.assert(
        fc.property(
          validWalk,
          badCoord,
          finiteCoord,
          fc.boolean(),
          fc.integer({ min: 1, max: 50 }),
          facingArb,
          (steps, bad, good, badIsX, dt, facing) => {
            const { controller, sprite } = makeController();
            walk(controller, steps);
            const before = snapshot(controller, sprite);
            const player = badIsX ? { x: bad, y: good } : { x: good, y: bad };
            expect(() => controller.update(player, dt, facing)).not.toThrow();
            expectUnchanged(controller, sprite, before);
            controller.destroy();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('null/undefined player leaves state unchanged', () => {
      fc.assert(
        fc.property(
          validWalk,
          fc.constantFrom(null, undefined),
          fc.integer({ min: 1, max: 50 }),
          facingArb,
          (steps, player, dt, facing) => {
            const { controller, sprite } = makeController();
            walk(controller, steps);
            const before = snapshot(controller, sprite);
            expect(() => controller.update(player, dt, facing)).not.toThrow();
            expectUnchanged(controller, sprite, before);
            controller.destroy();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('invalid followDistance makes update a no-op', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(-1, -48, -0.5, NaN, -Infinity, Infinity),
          validWalk,
          facingArb,
          (followDistance, steps, facing) => {
            const { controller, sprite } = makeController({ followDistance });
            const before = snapshot(controller, sprite);
            expect(() => {
              for (const s of steps) controller.update({ x: s.x, y: s.y }, s.dt, facing);
            }).not.toThrow();
            expectUnchanged(controller, sprite, before);
            controller.destroy();
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
