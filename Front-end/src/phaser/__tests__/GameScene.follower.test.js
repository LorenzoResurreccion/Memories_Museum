import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fc from 'fast-check';

// Same mock harness as GameScene.test.js: Phaser's Scene and the heavy subsystems are
// mocked, while FollowerController, followerTrail and EventBus are the REAL modules.
vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config.key;
    }
  }
}));

vi.mock('../PlayerController.js', () => ({
  WALK_FRAME_RATE: 4,
  default: class MockPlayerController {
    constructor(scene, sprite, speed) {
      this.scene = scene;
      this.sprite = sprite;
      this.speed = speed;
      this._frozen = false;
    }
    update() {}
    freeze() { this._frozen = true; }
    unfreeze() { this._frozen = false; }
    setBounds() {}
    setVerticalBounds() {}
    getFacingDirection() { return 'left'; }
  }
}));

vi.mock('../CollisionBuilder.js', () => ({
  default: class MockCollisionBuilder {
    constructor(scene, group) {
      this.scene = scene;
      this.group = group;
    }
    buildForLayer() { return []; }
  }
}));

vi.mock('../SegmentManager.js', () => ({
  default: class MockSegmentManager {
    constructor(deps) {
      this.deps = deps;
      this.segmentCount = 0;
    }
    update() {}
  }
}));

vi.mock('../InteractionManager.js', () => ({
  default: class MockInteractionManager {
    constructor(scene, bus) {
      this.scene = scene;
      this.bus = bus;
    }
    addZones() {}
    removeZones() {}
    isPlayerOverlappingZone() { return false; }
    checkInteraction() {}
    setLocked() {}
  }
}));

vi.mock('../PromptLabel.js', () => ({
  default: class MockPromptLabel {
    setVisible() {}
    follow() {}
  }
}));

import GameScene from '../GameScene.js';
import FollowerController from '../FollowerController.js';
import eventBus from '../EventBus.js';
import { resolveFollowerDepth } from '../followerTrail.js';

/** Make a fake follower sprite: no physics body, tracks position and depth. */
function makeFollowerSprite(x, y) {
  return {
    x,
    y,
    setOrigin: vi.fn(),
    setFrame: vi.fn(),
    setDepth: vi.fn(),
    setScale: vi.fn(),
    setPosition: vi.fn(function (nx, ny) { this.x = nx; this.y = ny; }),
    destroy: vi.fn()
  };
}

/**
 * Build a fully-mocked scene whose assets all load (including the follower texture).
 * @param {object} [opts]
 * @param {boolean} [opts.followerTexture=true]
 */
function makeScene({ followerTexture = true } = {}) {
  const scene = new GameScene();
  scene._loadError = false;
  scene.textures = {
    exists: vi.fn((key) => (key === 'follower' ? followerTexture : true))
  };

  const mockGroundLayer = { setDepth: vi.fn() };
  const mockPropsLayer = { setDepth: vi.fn(), setVisible: vi.fn(), forEachTile: vi.fn() };
  const mockMap = {
    tileWidth: 16,
    tileHeight: 16,
    addTilesetImage: vi.fn((name) => ({
      firstgid: name === 'museum_decor' ? 41 : 1,
      image: { key: name }
    })),
    createLayer: vi.fn((name) => {
      if (name === 'Tile Layer 1') return mockGroundLayer;
      if (name === 'Tile Layer 2') return mockPropsLayer;
      return null;
    }),
    getLayer: vi.fn((name) => {
      if (name === 'Tile Layer 1') return { name, data: [1, 1, 1], width: 3, height: 1 };
      if (name === 'Tile Layer 2') return { name };
      return null;
    }),
    getObjectLayer: vi.fn((name) =>
      name === 'Object Layer 1'
        ? { objects: [{ name: 'player_spawn', type: 'player_spawn', x: 160, y: 160 }] }
        : null
    ),
    widthInPixels: 928,
    heightInPixels: 240
  };
  const mockHallwayMap = {
    getLayer: vi.fn().mockReturnValue(null),
    getObjectLayer: vi.fn().mockReturnValue(null)
  };
  scene.make = {
    tilemap: vi.fn((cfg) => (cfg && cfg.key === 'museum_hallway' ? mockHallwayMap : mockMap))
  };

  // Fractional feet so "rounded feet" is observable.
  const playerSprite = {
    x: 160.4,
    y: 160.6,
    setDepth: vi.fn(),
    setOrigin: vi.fn(),
    setFrame: vi.fn(),
    body: { setCollideWorldBounds: vi.fn(), setSize: vi.fn(), setOffset: vi.fn() }
  };

  scene.physics = {
    add: {
      sprite: vi.fn().mockReturnValue(playerSprite),
      collider: vi.fn(),
      overlap: vi.fn(),
      staticGroup: vi.fn().mockReturnValue({ create: vi.fn() })
    },
    world: { setBounds: vi.fn() }
  };

  scene.input = {
    keyboard: {
      createCursorKeys: vi.fn().mockReturnValue({ up: {}, down: {}, left: {}, right: {} }),
      addKey: vi.fn().mockReturnValue({ isDown: false }),
      on: vi.fn()
    }
  };
  scene.cameras = {
    main: { width: 800, height: 600, setZoom: vi.fn(), setBounds: vi.fn(), startFollow: vi.fn() }
  };

  const sortGroup = { add: vi.fn(), remove: vi.fn(), getChildren: vi.fn().mockReturnValue([]) };
  const followerSprites = [];
  scene.add = {
    group: vi.fn().mockReturnValue(sortGroup),
    image: vi.fn().mockReturnValue({ setOrigin: vi.fn(), setDepth: vi.fn() }),
    text: vi.fn().mockReturnValue({ setOrigin: vi.fn(), setDepth: vi.fn(), setVisible: vi.fn() }),
    zone: vi.fn().mockReturnValue({ setOrigin: vi.fn() }),
    sprite: vi.fn((x, y) => {
      const s = makeFollowerSprite(x, y);
      followerSprites.push(s);
      return s;
    })
  };

  // Capture the shutdown registration so tests can fire it.
  const shutdownHandlers = [];
  scene.events = {
    once: vi.fn((evt, fn, ctx) => {
      if (evt === 'shutdown') shutdownHandlers.push(() => fn.call(ctx));
    })
  };

  return {
    scene,
    playerSprite,
    sortGroup,
    followerSprites,
    fireShutdown: () => shutdownHandlers.splice(0).forEach((h) => h())
  };
}

let warnSpy;
let liveScenes;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  liveScenes = [];
});

afterEach(() => {
  // The EventBus is a singleton: tear down controllers, then clear any handlers.
  for (const s of liveScenes) s._onShutdown();
  eventBus._listeners.clear();
  warnSpy.mockRestore();
});

function create(opts) {
  const ctx = makeScene(opts);
  liveScenes.push(ctx.scene);
  ctx.scene.create();
  return ctx;
}

describe('GameScene follower: preload()', () => {
  function makePreloadScene() {
    const scene = new GameScene();
    let errorHandler;
    scene.load = {
      on: (evt, handler) => { errorHandler = handler; },
      tilemapTiledJSON: vi.fn(),
      image: vi.fn(),
      spritesheet: vi.fn()
    };
    scene.time = { delayedCall: vi.fn() };
    scene.textures = { exists: vi.fn().mockReturnValue(false) };
    scene.preload();
    return { scene, fire: (f) => errorHandler(f) };
  }

  it('loads the follower spritesheet with 32x32 frames', () => {
    const scene = new GameScene();
    scene.load = { on: vi.fn(), tilemapTiledJSON: vi.fn(), image: vi.fn(), spritesheet: vi.fn() };
    scene.time = { delayedCall: vi.fn() };
    scene.preload();
    expect(scene.load.spritesheet).toHaveBeenCalledWith(
      'follower',
      'assets/sprites/Kelly_Sprite.png',
      { frameWidth: 32, frameHeight: 32 }
    );
  });

  it('follower loaderror is non-fatal and warns exactly once even if fired twice', () => {
    const { scene, fire } = makePreloadScene();
    fire({ type: 'spritesheet', key: 'follower' });
    fire({ type: 'spritesheet', key: 'follower' });
    expect(scene._loadError).toBe(false);
    expect(scene._errorMessage).toBeNull();
    expect(scene._followerSpriteError).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('follower');
  });

  it('a loaderror for another sheet still sets _loadError', () => {
    const { scene, fire } = makePreloadScene();
    fire({ type: 'image', key: 'museum_tileset' });
    expect(scene._loadError).toBe(true);
    expect(scene._followerSpriteError).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('GameScene follower: missing texture', () => {
  it('create/update/shutdown run without throwing or warning, with no controller', () => {
    const ctx = create({ followerTexture: false });
    const { scene } = ctx;
    expect(scene.followerController).toBeNull();
    expect(scene.add.sprite).not.toHaveBeenCalled();
    expect(() => scene.update(0, 16)).not.toThrow();
    expect(() => ctx.fireShutdown()).not.toThrow();
    expect(() => scene._onShutdown()).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('skips the follower when its spritesheet failed to load', () => {
    const ctx = makeScene();
    liveScenes.push(ctx.scene);
    ctx.scene._followerSpriteError = true;
    ctx.scene.create();
    expect(ctx.scene.followerController).toBeNull();
    expect(ctx.scene.add.sprite).not.toHaveBeenCalled();
  });
});

describe('GameScene follower: creation', () => {
  it('uses add.sprite (not physics) at the Player rounded feet, origin (0.5,1), scale untouched', () => {
    const { scene, playerSprite, sortGroup, followerSprites } = create();

    expect(scene.add.sprite).toHaveBeenCalledTimes(1);
    const [x, y, key] = scene.add.sprite.mock.calls[0];
    expect([x, y, key]).toEqual([Math.round(playerSprite.x), Math.round(playerSprite.y), 'follower']);

    const physicsCalls = scene.physics.add.sprite.mock.calls;
    expect(physicsCalls.every((c) => c[2] !== 'follower')).toBe(true);

    const sprite = followerSprites[0];
    expect(sprite.setOrigin).toHaveBeenCalledWith(0.5, 1);
    expect(sprite.setScale).not.toHaveBeenCalled();
    expect(sprite.body).toBeUndefined();
    expect(sortGroup.add).toHaveBeenCalledWith(sprite);
    expect(scene.followerController).toBeInstanceOf(FollowerController);
    expect(scene.followerController.sprite).toBe(sprite);
  });

  it('registers no collider or overlap involving the follower', () => {
    const { scene, followerSprites } = create();
    const calls = [...scene.physics.add.collider.mock.calls, ...scene.physics.add.overlap.mock.calls];
    for (const args of calls) {
      expect(args).not.toContain(followerSprites[0]);
      expect(args).not.toContain(scene.followerController);
    }
  });

  it('seeds the controller from the Player facing', () => {
    const { scene } = create();
    expect(scene.followerController.getFacingDirection()).toBe('left');
  });
});

describe('GameScene follower: update()', () => {
  it('runs after playerController.update, passing player, delta and facing', () => {
    const { scene } = create();
    const order = [];
    scene.playerController.update = vi.fn(() => order.push('player'));
    const fcSpy = vi.spyOn(scene.followerController, 'update').mockImplementation(() => {
      order.push('follower');
    });

    scene.update(1000, 16);

    expect(order).toEqual(['player', 'follower']);
    expect(fcSpy).toHaveBeenCalledWith(scene.player, 16, 'left');
  });

  it('defaults facing to "down" when getFacingDirection is missing', () => {
    const { scene } = create();
    scene.playerController.getFacingDirection = undefined;
    const fcSpy = vi.spyOn(scene.followerController, 'update').mockImplementation(() => {});
    scene.update(0, 16);
    expect(fcSpy).toHaveBeenCalledWith(scene.player, 16, 'down');
  });

  it('applies the depth override after the Y-sort loop (tie sits just behind the player)', () => {
    const { scene, sortGroup, followerSprites } = create();
    const f = followerSprites[0];
    vi.spyOn(scene.followerController, 'update').mockImplementation(() => {});
    sortGroup.getChildren.mockReturnValue([scene.player, f]);

    f.y = scene.player.y;
    scene.update(0, 16);
    const tieDepth = resolveFollowerDepth(f.y, scene.player.y);
    expect(tieDepth).toBeLessThan(scene.player.y);
    expect(f.setDepth).toHaveBeenLastCalledWith(tieDepth);
    // Y-sort loop ran first (called with y), override is the last call.
    expect(f.setDepth.mock.calls[0][0]).toBe(f.y);

    f.y = scene.player.y + 10;
    scene.update(0, 16);
    expect(f.setDepth).toHaveBeenLastCalledWith(f.y);
  });

  it('property: depth override always equals resolveFollowerDepth(f.y, player.y)', () => {
    const { scene, followerSprites } = create();
    const f = followerSprites[0];
    vi.spyOn(scene.followerController, 'update').mockImplementation(() => {});
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 }), (fy, py) => {
        f.y = fy;
        scene.player.y = py;
        scene.update(0, 16);
        expect(f.setDepth).toHaveBeenLastCalledWith(resolveFollowerDepth(fy, py));
      })
    );
  });

  it('InteractionManager and PromptLabel only ever receive the player', () => {
    const { scene, followerSprites } = create();
    const overlapSpy = vi.spyOn(scene.interactionManager, 'isPlayerOverlappingZone');
    const checkSpy = vi.spyOn(scene.interactionManager, 'checkInteraction');
    const visibleSpy = vi.spyOn(scene.promptLabel, 'setVisible');

    scene.update(0, 16);

    expect(overlapSpy).toHaveBeenCalledWith(scene.player);
    expect(checkSpy).toHaveBeenCalledWith(scene.player);
    for (const spy of [overlapSpy, checkSpy]) {
      for (const args of spy.mock.calls) {
        expect(args).not.toContain(followerSprites[0]);
        expect(args).not.toContain(scene.followerController);
      }
    }
    // Only the Follower overlapping a zone (Player not): prompt stays hidden.
    expect(visibleSpy).toHaveBeenLastCalledWith(false);
  });

  it('shows the prompt only when the Player overlaps (sanity for the hidden case)', () => {
    const { scene } = create();
    vi.spyOn(scene.interactionManager, 'isPlayerOverlappingZone').mockReturnValue(true);
    const visibleSpy = vi.spyOn(scene.promptLabel, 'setVisible');
    scene.update(0, 16);
    expect(visibleSpy).toHaveBeenLastCalledWith(true);
  });
});

describe('GameScene follower: _releaseSegment()', () => {
  it('leaves the controller trail unchanged', () => {
    const { scene } = create();
    const before = JSON.stringify(scene.followerController.trail);
    const trailRef = scene.followerController.trail;

    scene._releaseSegment({
      floorSprites: [{ destroy: vi.fn() }],
      layer2Sprites: [{ destroy: vi.fn() }],
      collisionBodies: [{ destroy: vi.fn() }],
      paintingSprites: [{ destroy: vi.fn() }],
      zones: []
    });

    expect(scene.followerController.trail).toBe(trailRef);
    expect(JSON.stringify(scene.followerController.trail)).toBe(before);
    expect(scene.followerController).not.toBeNull();
  });
});

describe('GameScene follower: _getCollisionBoxes()', () => {
  /** Fake static group whose destroyed children drop out of getChildren(). */
  function makeFakeGroup() {
    const children = [];
    const group = {
      getChildren: () => children.slice(),
      add(rect) {
        const child = {
          body: rect ? { ...rect } : undefined,
          destroy() {
            const i = children.indexOf(child);
            if (i >= 0) children.splice(i, 1);
            this.body = null;
          }
        };
        children.push(child);
        return child;
      }
    };
    return group;
  }

  it('returns body rects and skips body-less children', () => {
    const { scene } = create();
    const group = makeFakeGroup();
    group.add({ x: 1, y: 2, width: 16, height: 8 });
    group.add(null);
    group.add({ x: 5, y: 6, width: 4, height: 4 });
    scene.collisionGroup = group;

    expect(scene._getCollisionBoxes()).toEqual([
      { x: 1, y: 2, width: 16, height: 8 },
      { x: 5, y: 6, width: 4, height: 4 }
    ]);
  });

  it('returns [] for a null group', () => {
    const { scene } = create();
    scene.collisionGroup = null;
    expect(scene._getCollisionBoxes()).toEqual([]);
  });

  it('drops destroyed segment bodies, keeps start-map boxes, never includes the Player', () => {
    const { scene } = create();
    const group = makeFakeGroup();
    group.add({ x: 0, y: 0, width: 16, height: 16 }); // start map
    const seg = [
      group.add({ x: 928, y: 0, width: 16, height: 16 }),
      group.add({ x: 944, y: 0, width: 16, height: 16 })
    ];
    scene.collisionGroup = group;
    expect(scene._getCollisionBoxes()).toHaveLength(3);

    scene._releaseSegment({ collisionBodies: seg });

    expect(scene._getCollisionBoxes()).toEqual([{ x: 0, y: 0, width: 16, height: 16 }]);
    // The Player's body is not a member of the static group.
    expect(group.getChildren().some((c) => c === scene.player)).toBe(false);
  });
});

describe('GameScene follower: shutdown', () => {
  it('destroys the controller and removes its bus listeners', () => {
    const { scene, followerSprites, fireShutdown } = create();
    const controller = scene.followerController;

    fireShutdown();

    expect(scene.followerController).toBeNull();
    expect(followerSprites[0].destroy).toHaveBeenCalled();
    eventBus.emit('hotspot-activated', { id: 'x', text: ['hi'], imageUrl: null });
    expect(controller.isFrozen).toBe(false);
  });

  it('a second create() builds exactly one new controller with a fresh trail', () => {
    const ctx = create();
    const { scene } = ctx;
    const first = scene.followerController;
    // Walk the first controller so its trail differs from a fresh one.
    scene.player.x = 200;
    scene.player.y = 160;
    first.update(scene.player, 16, 'down');

    ctx.fireShutdown();
    const spritesBefore = scene.add.sprite.mock.calls.length;
    scene.create();

    const second = scene.followerController;
    expect(second).toBeInstanceOf(FollowerController);
    expect(second).not.toBe(first);
    expect(scene.add.sprite.mock.calls.length - spritesBefore).toBe(1);
    expect(second.trail.samples).toHaveLength(1);

    // Only the new controller reacts to the bus.
    eventBus.emit('hotspot-activated', { id: 'x', text: ['hi'], imageUrl: null });
    expect(second.isFrozen).toBe(true);
    expect(first.isFrozen).toBe(false);
  });
});
