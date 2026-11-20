/**
 * FollowerController — drives Kelly, the purely visual companion that trails the Player.
 *
 * Kelly replays the path the Player actually walked (see followerTrail.js). She has no
 * physics body and emits no events. All trail arithmetic lives in the Phaser-free
 * followerTrail.js; this class owns the sprite, animations, facing and bounds.
 *
 * Mirrors PlayerController's style: defensive `typeof` checks so partial test mocks work.
 *
 * Two movement modes (Frozen is a separate gate): Following (replay the trail) and
 * Settling (walk to a collision-checked rest spot when the Player stops too close).
 * Collision boxes are queried only when a settle is being decided, never per frame.
 *
 * Requirements: 1.2, 1.3, 2.6, 3.1-3.5, 3.7, 4.6, 5.1-5.6, 7.8, 8.1, 8.6, 8.8, 9.1, 12.2, 12.3,
 *               13.1-13.18
 */

import {
  FOLLOW_DISTANCE_PX,
  MIN_SEPARATION_PX,
  MOVE_EPSILON_PX,
  MAX_FRAME_DELTA_MS,
  TELEPORT_THRESHOLD_PX,
  FRAMES_PER_ROW,
  createTrail,
  stepTrail,
  followerPosition,
  clampPoint,
  facingFromDelta,
  frameIndexFor,
  isValidStepInput,
  distance,
  shouldSettle,
  stepToward,
  reseedTrail,
} from './followerTrail.js';
import { sanitizeBoxes, chooseSettleTarget, isValidPosition } from './followerCollision.js';

/** Texture key of the Follower spritesheet (loaded in GameScene.preload()). */
export const FOLLOWER_SPRITE_KEY = 'follower';

const DIRECTIONS = ['down', 'left', 'right', 'up'];

export default class FollowerController {
  /**
   * @param {Phaser.Scene} scene
   * @param {Phaser.GameObjects.Sprite} sprite - Kelly (origin 0.5,1; no physics body)
   * @param {object} eventBus - pub/sub bus (subscribed to in a later task)
   * @param {object} [options]
   * @param {number} [options.followDistance=FOLLOW_DISTANCE_PX]
   * @param {number} [options.speed=80] - px/s cap (same as the Player's speed)
   * @param {number} [options.frameRate=4] - walk animation fps
   * @param {'up'|'down'|'left'|'right'} [options.initialFacing='down']
   * @param {{x:number,y:number}} [options.startPosition] - Player feet at creation
   * @param {() => Array<{x:number,y:number,width:number,height:number}>} [options.getCollisionBoxes]
   * @param {number} [options.minSeparation=MIN_SEPARATION_PX]
   */
  constructor(scene, sprite, eventBus, options = {}) {
    const {
      followDistance = FOLLOW_DISTANCE_PX,
      speed = 80,
      frameRate = 4,
      initialFacing = 'down',
      startPosition,
      getCollisionBoxes = () => [],
      minSeparation = MIN_SEPARATION_PX,
    } = options;

    this.scene = scene;
    this.sprite = sprite;
    this.eventBus = eventBus;
    this.followDistance = followDistance;
    this.speed = speed;
    this.frameRate = frameRate;
    this.getCollisionBoxes = getCollisionBoxes;
    this.minSeparation = minSeparation;

    /** @type {boolean} */
    this._frozen = false;

    /** @type {'up'|'down'|'left'|'right'} */
    this._facing = DIRECTIONS.includes(initialFacing) ? initialFacing : 'down';

    /** Horizontal clamp bounds (feet X); no-op until set. */
    this.minX = -Infinity;
    this.maxX = Infinity;
    /** Vertical clamp bounds (feet Y); no-op until set. */
    this.minFeetY = -Infinity;
    this.maxFeetY = Infinity;

    const start = startPosition || { x: sprite?.x ?? 0, y: sprite?.y ?? 0 };

    /** @type {import('./followerTrail.js').TrailState} */
    this._trail = createTrail(start);

    /** Unrounded Follower position; the sprite shows its rounded value. */
    this._pos = { x: start.x, y: start.y };

    /** @type {boolean} */
    this._destroyed = false;

    /** @type {'following'|'settling'} */
    this._mode = 'following';
    /** @type {{x:number,y:number}|null} Rest spot chosen once when settling starts. */
    this._settleTarget = null;
    /** Latch: no valid target / query threw / invalid step. Cleared when the Player moves. */
    this._settleBlocked = false;
    /** @type {Array<{x:number,y:number,width:number,height:number}>} */
    this._boxSnapshot = [];

    this._createAnimations();

    if (this.sprite && typeof this.sprite.setFrame === 'function') {
      this.sprite.setFrame(frameIndexFor(this._facing, 0));
    }

    // Named handlers so destroy() can unsubscribe exactly what it registered.
    this._onActivated = () => this.freeze();
    this._onDismissed = () => this.unfreeze();

    /** @type {Array<[string, Function]>} registrations made on the bus */
    this._subscriptions = [];
    if (this.eventBus && typeof this.eventBus.on === 'function') {
      const registrations = [
        ['hotspot-activated', this._onActivated],
        ['dialogue-dismissed', this._onDismissed],
        ['image-dismissed', this._onDismissed],
      ];
      for (const [event, handler] of registrations) {
        this.eventBus.on(event, handler);
        this._subscriptions.push([event, handler]);
      }
    }
  }

  /**
   * Freeze the Follower in place and show the idle pose. Idempotent.
   * Never touches the trail or position.
   */
  freeze() {
    if (this._destroyed || this._frozen) return;
    this._frozen = true;
    this._playAnimation(false);
  }

  /** Resume following. Idempotent; clears the flag only (no position change). */
  unfreeze() {
    if (this._destroyed || !this._frozen) return;
    this._frozen = false;
  }

  /**
   * Unsubscribe from the bus, clear the trail and destroy the sprite. Safe to call twice.
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    if (this.eventBus && typeof this.eventBus.off === 'function') {
      for (const [event, handler] of this._subscriptions) {
        this.eventBus.off(event, handler);
      }
    }
    this._subscriptions = [];

    this._trail = { samples: [], gap: 0 };
    this._mode = 'following';
    this._settleTarget = null;
    this._boxSnapshot = [];

    const sprite = this.sprite;
    if (sprite && typeof sprite.destroy === 'function') {
      sprite.destroy();
    }
    this.sprite = null;
  }

  /**
   * Create walk and idle animations for the four facings, reusing any that already
   * exist (the scene instance survives restarts).
   */
  _createAnimations() {
    const anims = this.scene?.anims;
    if (!anims || typeof anims.create !== 'function') return;

    const spriteKey = this.sprite?.texture?.key || FOLLOWER_SPRITE_KEY;
    const exists = (key) => (typeof anims.exists === 'function' ? anims.exists(key) : false);

    DIRECTIONS.forEach((dir, rowIndex) => {
      const walkKey = `follower-walk-${dir}`;
      const idleKey = `follower-idle-${dir}`;
      const rowStart = rowIndex * FRAMES_PER_ROW;

      if (!exists(walkKey)) {
        anims.create({
          key: walkKey,
          frames: anims.generateFrameNumbers(spriteKey, {
            start: rowStart,
            end: rowStart + FRAMES_PER_ROW - 1,
          }),
          frameRate: this.frameRate,
          repeat: -1,
        });
      }

      if (!exists(idleKey)) {
        anims.create({
          key: idleKey,
          frames: [{ key: spriteKey, frame: rowStart }],
          frameRate: 1,
          repeat: 0,
        });
      }
    });
  }

  /**
   * Advance the Follower one frame. Call once per frame after the Player has moved.
   * No-op while frozen, destroyed, or when inputs are invalid.
   *
   * @param {{x:number,y:number}} player - Player sprite (feet position, origin 0.5,1)
   * @param {number} deltaMs - frame delta in ms
   * @param {'up'|'down'|'left'|'right'} [playerFacing='down'] - read only when settling starts
   */
  update(player, deltaMs, playerFacing = 'down') {
    if (this._destroyed || this._frozen || !this.sprite) return;
    if (!player || !isValidStepInput(this.followDistance, deltaMs, this.speed, { x: player.x, y: player.y })) {
      return;
    }
    const playerPos = { x: player.x, y: player.y };

    // Evaluated before stepTrail mutates anything. A teleport frame differs from the
    // newest sample, so it is never "stopped".
    const samples = this._trail.samples;
    const newest = samples.length > 0 ? samples[samples.length - 1] : null;
    const playerStopped = newest !== null && newest.x === playerPos.x && newest.y === playerPos.y;

    if (this._mode === 'settling') {
      if (!playerStopped) {
        this._cancelSettle(playerPos, newest);
      } else {
        this._stepSettling(playerPos, deltaMs);
      }
      return;
    }

    if (!playerStopped) this._settleBlocked = false;
    const posBefore = { x: this._pos.x, y: this._pos.y };
    this._stepFollowing(playerPos, deltaMs);
    const followMoved = distance(posBefore, this._pos);

    if (
      playerStopped &&
      !this._settleBlocked &&
      shouldSettle({
        playerStopped,
        gap: this._trail.gap,
        followDistance: this.followDistance,
        followerPos: this._pos,
        playerPos,
        minSeparation: this.minSeparation,
      })
    ) {
      // The Following step and the first Settling step share one frame's movement
      // budget, so the switch frame never exceeds the speed cap.
      const maxStep = (this.speed * Math.min(deltaMs, MAX_FRAME_DELTA_MS)) / 1000;
      this._beginSettle(playerPos, playerFacing, deltaMs, Math.max(0, maxStep - followMoved));
    }
  }

  /**
   * Decide a settle: query boxes once, pick a target. On success enter Settling and take
   * the first step in this same update; otherwise latch blocked and hold.
   */
  _beginSettle(playerPos, playerFacing, deltaMs, budget) {
    let target;
    let boxes = [];
    try {
      boxes = sanitizeBoxes(this.getCollisionBoxes());
      target = chooseSettleTarget(
        playerPos,
        playerFacing,
        this.followDistance,
        this._bounds(),
        boxes,
        this._pos,
      );
    } catch {
      target = null;
    }
    if (!target) {
      this._settleBlocked = true;
      return;
    }
    this._boxSnapshot = boxes;
    this._settleTarget = target;
    this._mode = 'settling';
    this._stepSettling(playerPos, deltaMs, budget);
  }

  /** Return to Following mode and drop the settle target and box snapshot. */
  _leaveSettling() {
    this._mode = 'following';
    this._settleTarget = null;
    this._boxSnapshot = [];
  }

  /**
   * Settling, Player moved: teleport reset if the jump exceeds the threshold, otherwise
   * cancel with zero position change and reseed the trail from the Follower.
   */
  _cancelSettle(playerPos, newest) {
    this._leaveSettling();
    this._settleBlocked = false;
    if (newest && distance(newest, playerPos) > TELEPORT_THRESHOLD_PX) {
      this._trail = createTrail(playerPos);
      this._pos = clampPoint(playerPos, this._bounds());
      this._applyPosition();
      this._playAnimation(false);
      return;
    }
    this._trail = reseedTrail(this._pos, playerPos);
    this._playAnimation(false);
  }

  /**
   * Settling, Player stopped: one step toward the target, validated on the rounded
   * sprite position against the snapshot taken at settle start.
   */
  _stepSettling(playerPos, deltaMs, budget) {
    const maxStep =
      typeof budget === 'number'
        ? budget
        : (this.speed * Math.min(deltaMs, MAX_FRAME_DELTA_MS)) / 1000;
    const bounds = this._bounds();
    const { pos, arrived } = stepToward(this._pos, this._settleTarget, maxStep);
    const next = clampPoint(pos, bounds);

    const shown = { x: Math.round(next.x), y: Math.round(next.y) };
    if (!isValidPosition(shown, this._boxSnapshot, bounds)) {
      // Abandon: hold the previous position.
      this._leaveSettling();
      this._settleBlocked = true;
      this._trail = reseedTrail(this._pos, playerPos);
      this._playAnimation(false);
      return;
    }

    const dx = next.x - this._pos.x;
    const dy = next.y - this._pos.y;
    const moved = Math.max(Math.abs(dx), Math.abs(dy)) >= MOVE_EPSILON_PX;
    this._facing = facingFromDelta(dx, dy, this._facing);
    this._pos = next;
    this._applyPosition();

    if (arrived) {
      this._trail = reseedTrail(this._pos, playerPos);
      this._leaveSettling();
      this._playAnimation(false);
    } else {
      this._playAnimation(moved);
    }
  }

  /**
   * Following mode: record the Player position, advance along the trail, then
   * update facing/animation and the sprite position.
   * @param {{x:number,y:number}} playerPos
   * @param {number} deltaMs
   */
  _stepFollowing(playerPos, deltaMs) {
    const { state, teleported } = stepTrail(this._trail, playerPos, {
      followDistance: this.followDistance,
      deltaMs,
      speed: this.speed,
    });
    this._trail = state;

    if (teleported) {
      this._pos = clampPoint(playerPos, this._bounds());
      this._applyPosition();
      this._playAnimation(false);
      return;
    }

    const next = clampPoint(followerPosition(this._trail), this._bounds());
    const dx = next.x - this._pos.x;
    const dy = next.y - this._pos.y;
    const moved = Math.max(Math.abs(dx), Math.abs(dy)) >= MOVE_EPSILON_PX;

    this._facing = facingFromDelta(dx, dy, this._facing);
    this._pos = next;
    this._applyPosition();
    this._playAnimation(moved);
  }

  /** Current clamp bounds as a followerTrail Bounds object. */
  _bounds() {
    return { minX: this.minX, maxX: this.maxX, minY: this.minFeetY, maxY: this.maxFeetY };
  }

  /** Show the whole-pixel rounded float position on the sprite. */
  _applyPosition() {
    const x = Math.round(this._pos.x);
    const y = Math.round(this._pos.y);
    if (typeof this.sprite.setPosition === 'function') {
      this.sprite.setPosition(x, y);
    } else {
      this.sprite.x = x;
      this.sprite.y = y;
    }
  }

  /**
   * Play the walk or idle animation for the current facing.
   * @param {boolean} walking
   */
  _playAnimation(walking) {
    if (this.sprite?.anims && typeof this.sprite.anims.play === 'function') {
      const key = `${walking ? 'follower-walk' : 'follower-idle'}-${this._facing}`;
      this.sprite.anims.play(key, true);
    }
  }

  /**
   * Set the horizontal clamp bounds. Non-number args leave a bound unchanged.
   * @param {number} [minX]
   * @param {number} [maxX]
   */
  setBounds(minX, maxX) {
    if (typeof minX === 'number') this.minX = minX;
    if (typeof maxX === 'number') this.maxX = maxX;
  }

  /**
   * Set the vertical (feet Y) clamp bounds. Non-number args leave a bound unchanged.
   * @param {number} [minFeetY]
   * @param {number} [maxFeetY]
   */
  setVerticalBounds(minFeetY, maxFeetY) {
    if (typeof minFeetY === 'number') this.minFeetY = minFeetY;
    if (typeof maxFeetY === 'number') this.maxFeetY = maxFeetY;
  }

  /**
   * @returns {'up'|'down'|'left'|'right'}
   */
  getFacingDirection() {
    return this._facing;
  }

  /** @returns {'following'|'settling'} */
  get mode() {
    return this._mode;
  }

  /** @returns {{x:number,y:number}|null} */
  get settleTarget() {
    return this._settleTarget;
  }

  /** @returns {boolean} */
  get isFrozen() {
    return this._frozen;
  }

  /** Read-only view of the trail state (tests/debug). */
  get trail() {
    return this._trail;
  }
}
