/**
 * Example tests for FollowerController (Kelly, the trailing companion).
 *
 * Uses the real EventBus singleton, so every controller is destroyed in afterEach and
 * unrelated listeners are removed explicitly.
 *
 * Requirements: 1.3, 5.2, 5.4, 6.1, 6.3, 11.1-11.5, 13.2, 13.3, 13.5, 13.6, 13.7, 13.9
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import eventBus from '../EventBus.js';
import FollowerController from '../FollowerController.js';

const FACINGS = ['down', 'left', 'right', 'up'];
const ROW = { down: 0, left: 1, right: 2, up: 3 };
const DELTA = 25; // ms -> 2 px per frame at speed 80

const created = [];
const extraListeners = [];

function makeScene({ exists = false, generateFrameNumbers } = {}) {
  return {
    anims: {
      exists: vi.fn(() => exists),
      create: vi.fn(),
      generateFrameNumbers:
        generateFrameNumbers || vi.fn((key, cfg) => ({ key, ...cfg })),
    },
  };
}

function makeSprite(x = 0, y = 0) {
  const sprite = {
    x,
    y,
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

function make(options = {}, { scene = makeScene(), start = { x: 88, y: 100 } } = {}) {
  const sprite = makeSprite(start.x, start.y);
  const ctrl = new FollowerController(scene, sprite, eventBus, {
    startPosition: start,
    ...options,
  });
  created.push(ctrl);
  return { ctrl, sprite, scene };
}

const lastAnim = (sprite) => sprite.anims.play.mock.calls.at(-1)?.[0];

/** Walk the player by dx px in 2px frames, updating the controller each frame. */
function walk(ctrl, player, dx, facing) {
  const dir = Math.sign(dx);
  const frames = Math.abs(dx) / 2;
  for (let i = 0; i < frames; i++) {
    player.x += dir * 2;
    ctrl.update(player, DELTA, facing);
  }
}

/** Motivating case up to (and including) the first stopped frame. */
function driveToSettle(options = {}) {
  const made = make(options);
  const player = { x: 88, y: 100 };
  walk(made.ctrl, player, 40, 'right');
  walk(made.ctrl, player, -12, 'left');
  made.ctrl.update(player, DELTA, 'left'); // first stopped frame
  return { ...made, player };
}

afterEach(() => {
  while (created.length) created.pop().destroy();
  for (const [event, fn] of extraListeners.splice(0)) eventBus.off(event, fn);
  vi.restoreAllMocks();
});

describe('animations', () => {
  it('registers walk and idle animations for four facings at the injected frame rate', () => {
    const { scene } = make({ frameRate: 7 });
    const calls = scene.anims.create.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(8);
    for (const dir of FACINGS) {
      const walkCfg = calls.find((c) => c.key === `follower-walk-${dir}`);
      const idleCfg = calls.find((c) => c.key === `follower-idle-${dir}`);
      expect(walkCfg).toBeDefined();
      expect(idleCfg).toBeDefined();
      expect(walkCfg.frameRate).toBe(7);
      expect(walkCfg.repeat).toBe(-1);
      expect(walkCfg.frames.start).toBe(ROW[dir] * 4);
      expect(walkCfg.frames.end).toBe(ROW[dir] * 4 + 3);
      expect(idleCfg.frames[0].frame).toBe(ROW[dir] * 4);
    }
  });

  it('skips anims.create when anims.exists returns true', () => {
    const { scene } = make({}, { scene: makeScene({ exists: true }) });
    expect(scene.anims.create).not.toHaveBeenCalled();
  });
});

describe('initial frame, walk/idle switching, facing', () => {
  it.each(FACINGS)('shows the neutral frame for initial facing %s', (dir) => {
    const { sprite } = make({ initialFacing: dir });
    expect(sprite.setFrame).toHaveBeenCalledWith(ROW[dir] * 4);
  });

  it('plays walk while following, then idle and keeps the facing once the player stops', () => {
    const { ctrl, sprite } = make();
    const player = { x: 88, y: 100 };
    walk(ctrl, player, 40, 'right');
    expect(lastAnim(sprite)).toBe('follower-walk-right');
    expect(ctrl.getFacingDirection()).toBe('right');

    ctrl.update(player, DELTA, 'right'); // stopped, gap == follow distance, far enough: holds
    expect(lastAnim(sprite)).toBe('follower-idle-right');
    expect(ctrl.getFacingDirection()).toBe('right');
    expect(ctrl.mode).toBe('following');
  });
});

describe('freeze / unfreeze over the EventBus', () => {
  it('freezes with the idle pose in the same call as hotspot-activated', () => {
    const { ctrl, sprite } = make();
    const player = { x: 88, y: 100 };
    walk(ctrl, player, 40, 'right');
    expect(lastAnim(sprite)).toBe('follower-walk-right');

    eventBus.emit('hotspot-activated', { id: 1 });
    expect(ctrl.isFrozen).toBe(true);
    expect(lastAnim(sprite)).toBe('follower-idle-right');

    const x = sprite.x;
    walk(ctrl, player, 10, 'right');
    expect(sprite.x).toBe(x);
  });

  it.each(['dialogue-dismissed', 'image-dismissed'])('%s unfreezes', (event) => {
    const { ctrl } = make();
    eventBus.emit('hotspot-activated', {});
    expect(ctrl.isFrozen).toBe(true);
    eventBus.emit(event);
    expect(ctrl.isFrozen).toBe(false);
  });
});

describe('settling', () => {
  it('motivating case: walks right to the rest spot behind a left-facing player and ends idle facing right', () => {
    const { ctrl, sprite, player } = driveToSettle();
    expect(ctrl.mode).toBe('settling');
    expect(ctrl.settleTarget).toEqual({ x: player.x + 24, y: 100 });
    expect(lastAnim(sprite)).toBe('follower-walk-right');

    for (let i = 0; i < 40 && ctrl.mode === 'settling'; i++) {
      ctrl.update(player, DELTA, 'left');
    }
    expect(ctrl.mode).toBe('following');
    expect(sprite.x).toBe(player.x + 24);
    expect(sprite.y).toBe(100);
    expect(lastAnim(sprite)).toBe('follower-idle-right');
    expect(ctrl.getFacingDirection()).toBe('right');
    expect(ctrl.trail.samples).toEqual([
      { x: player.x + 24, y: 100 },
      { x: player.x, y: 100 },
    ]);
  });

  it('cancels when the player moves: sprite stays put and the trail is [followerPos, playerFeet]', () => {
    const { ctrl, sprite, player } = driveToSettle();
    ctrl.update(player, DELTA, 'left');
    ctrl.update(player, DELTA, 'left');
    expect(ctrl.mode).toBe('settling');
    const { x, y } = sprite;

    player.x -= 2;
    ctrl.update(player, DELTA, 'left');
    expect(ctrl.mode).toBe('following');
    expect(sprite.x).toBe(x);
    expect(sprite.y).toBe(y);
    expect(ctrl.trail.samples).toEqual([
      { x, y },
      { x: player.x, y: player.y },
    ]);
  });

  it('holds while frozen during Settling and resumes after unfreeze', () => {
    const { ctrl, sprite, player } = driveToSettle();
    expect(ctrl.mode).toBe('settling');
    ctrl.freeze();
    const x = sprite.x;
    for (let i = 0; i < 5; i++) ctrl.update(player, DELTA, 'left');
    expect(sprite.x).toBe(x);
    expect(ctrl.mode).toBe('settling');

    ctrl.unfreeze();
    ctrl.update(player, DELTA, 'left');
    expect(sprite.x).toBeGreaterThan(x);
  });
});

describe('collision-box queries', () => {
  // Player at (200,100) facing left: candidates are behind (224,100), front (176,100),
  // above (200,76), below (200,124). One box per candidate footprint.
  const blockAll = [
    { x: 216, y: 84, width: 16, height: 16 },
    { x: 168, y: 84, width: 16, height: 16 },
    { x: 192, y: 60, width: 16, height: 16 },
    { x: 192, y: 108, width: 16, height: 16 },
  ];
  const at200 = { start: { x: 200, y: 100 } };

  it('holds when every candidate is blocked and queries exactly once; a player move clears the latch', () => {
    const getCollisionBoxes = vi.fn(() => blockAll);
    const { ctrl, sprite } = make({ getCollisionBoxes }, at200);
    const player = { x: 200, y: 100 };

    for (let i = 0; i < 30; i++) ctrl.update(player, DELTA, 'left');
    expect(getCollisionBoxes).toHaveBeenCalledTimes(1);
    expect(ctrl.mode).toBe('following');
    expect(sprite.x).toBe(200);
    expect(sprite.y).toBe(100);

    player.x = 202;
    ctrl.update(player, DELTA, 'left'); // moving: latch cleared, no query
    expect(getCollisionBoxes).toHaveBeenCalledTimes(1);
    ctrl.update(player, DELTA, 'left'); // stopped again: queries again
    expect(getCollisionBoxes).toHaveBeenCalledTimes(2);
    expect(ctrl.mode).toBe('following');
  });

  it('holds without throwing when getCollisionBoxes throws', () => {
    const getCollisionBoxes = vi.fn(() => {
      throw new Error('boom');
    });
    const { ctrl, sprite } = make({ getCollisionBoxes }, at200);
    const player = { x: 200, y: 100 };
    expect(() => {
      for (let i = 0; i < 5; i++) ctrl.update(player, DELTA, 'left');
    }).not.toThrow();
    expect(ctrl.mode).toBe('following');
    expect(sprite.x).toBe(200);
    expect(getCollisionBoxes).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed boxes and uses only the valid one (behind blocked, so front is chosen)', () => {
    const getCollisionBoxes = vi.fn(() => [
      null,
      { x: NaN, y: 0, width: 16, height: 16 },
      { x: 216, y: 84, width: 16, height: 16 },
    ]);
    const { ctrl } = make({ getCollisionBoxes }, at200);
    ctrl.update({ x: 200, y: 100 }, DELTA, 'left');
    expect(ctrl.mode).toBe('settling');
    expect(ctrl.settleTarget).toEqual({ x: 176, y: 100 });
  });

  it('defaults to an empty query: settles to the behind spot', () => {
    const { ctrl } = make({}, at200);
    ctrl.update({ x: 200, y: 100 }, DELTA, 'down');
    expect(ctrl.mode).toBe('settling');
    expect(ctrl.settleTarget).toEqual({ x: 200, y: 76 });
  });

  it('never queries while the player is moving', () => {
    const getCollisionBoxes = vi.fn(() => []);
    const { ctrl } = make({ getCollisionBoxes });
    const player = { x: 88, y: 100 };
    walk(ctrl, player, 60, 'right');
    expect(getCollisionBoxes).not.toHaveBeenCalled();
  });
});

describe('destroy', () => {
  it('removes only its own three listeners', () => {
    const unrelated = vi.fn();
    eventBus.on('hotspot-activated', unrelated);
    extraListeners.push(['hotspot-activated', unrelated]);

    const offSpy = vi.spyOn(eventBus, 'off');
    const { ctrl } = make();
    ctrl.destroy();

    const events = offSpy.mock.calls.map((c) => c[0]).sort();
    expect(events).toEqual(['dialogue-dismissed', 'hotspot-activated', 'image-dismissed']);

    eventBus.emit('hotspot-activated', {});
    expect(unrelated).toHaveBeenCalledTimes(1);
    expect(ctrl.isFrozen).toBe(false);
  });

  it('is idempotent: sprite.destroy runs once and a second call does not throw', () => {
    const { ctrl, sprite } = make();
    ctrl.destroy();
    expect(() => ctrl.destroy()).not.toThrow();
    expect(sprite.destroy).toHaveBeenCalledTimes(1);
  });

  it('repeated create/destroy leaves one handler per event', () => {
    for (let i = 0; i < 3; i++) make().ctrl.destroy();
    const { ctrl: live } = make();
    const { ctrl: dead } = make();
    dead.destroy();

    eventBus.emit('hotspot-activated', {});
    expect(live.isFrozen).toBe(true);
    eventBus.emit('dialogue-dismissed');
    expect(live.isFrozen).toBe(false);
  });
});
