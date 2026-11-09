/**
 * PlayerController — encapsulates player movement logic.
 *
 * Cardinal-only movement with most-recent-key-priority resolution.
 * Passes flat velocity values to sprite.setVelocity() — Phaser Arcade Physics
 * handles frame-rate-independent integration internally (do NOT multiply by deltaTime).
 *
 * Also applies a two-sided horizontal clamp to keep the player inside the bounded
 * hallway: X is constrained to [minX, maxX] each update, with leftward velocity zeroed
 * at minX and rightward velocity zeroed at maxX. `maxX` may be updated at runtime via
 * setBounds() as the final segment's right edge becomes known (Req 13.3). GameScene is
 * responsible for pinning the physics world left/right bounds to the same [minX, maxX].
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.3, 5.4, 13.3
 */

/**
 * Number of frames in each direction row of the player spritesheet (columns per row).
 * The 32×32 sheet is 4 columns wide: neutral, step, neutral, step. Change this if the
 * sheet's column count changes — frame index = row * FRAMES_PER_ROW + column.
 */
const FRAMES_PER_ROW = 4;

export default class PlayerController {
  /**
   * @param {Phaser.Scene} scene - The scene this controller belongs to
   * @param {Phaser.Physics.Arcade.Sprite} sprite - The player sprite
   * @param {number} [speed=120] - Movement speed in px/s (range 60–240)
   */
  constructor(scene, sprite, speed = 120) {
    this.scene = scene;
    this.sprite = sprite;
    this.speed = speed;

    /** @type {boolean} */
    this._frozen = false;

    /** @type {string} */
    this._facing = 'down';

    /**
     * Ordered stack of currently held directional keys.
     * Most recently pressed key is at the end (highest priority).
     * @type {string[]}
     */
    this._keyStack = [];

    /** @type {number} */
    this._animFrameRate = 4;

    /**
     * Left horizontal clamp bound (start-map floor left edge). Defaults to
     * -Infinity so the clamp is a no-op until bounds are provided via setBounds().
     * @type {number}
     */
    this.minX = -Infinity;

    /**
     * Right horizontal clamp bound (final segment floor right edge). Defaults to
     * +Infinity so the clamp is a no-op until the final segment's right edge is
     * known; GameScene/SegmentManager may update it at runtime (Req 13.3).
     * @type {number}
     */
    this.maxX = Infinity;

    /**
     * Top vertical clamp bound for the player's feet (world Y). The sprite uses a
     * feet origin (0.5, 1), so `sprite.y` IS the feet position. This is the world Y
     * of the walkable floor's top edge — the player's feet may not step above it
     * (onto the back wall). Defaults to -Infinity (no-op until GameScene provides it).
     * @type {number}
     */
    this.minFeetY = -Infinity;

    /**
     * Bottom vertical clamp bound for the player's feet (world Y) — the walkable
     * floor's bottom edge. Defaults to +Infinity (no-op until provided).
     * @type {number}
     */
    this.maxFeetY = Infinity;

    // Set up key press/release tracking via scene input
    this._setupKeyTracking();

    // Create animations for the player sprite
    this._createAnimations();
  }

  /**
   * Track key press order using scene keyboard events.
   * This enables most-recent-key-priority resolution.
   */
  _setupKeyTracking() {
    if (!this.scene.input || !this.scene.input.keyboard) return;

    this.scene.input.keyboard.on('keydown', (event) => {
      const dir = this._keyCodeToDirection(event.keyCode);
      if (dir) {
        // Remove if already in stack, then push to end (most recent)
        const idx = this._keyStack.indexOf(dir);
        if (idx !== -1) {
          this._keyStack.splice(idx, 1);
        }
        this._keyStack.push(dir);
      }
    });

    this.scene.input.keyboard.on('keyup', (event) => {
      const dir = this._keyCodeToDirection(event.keyCode);
      if (dir) {
        const idx = this._keyStack.indexOf(dir);
        if (idx !== -1) {
          this._keyStack.splice(idx, 1);
        }
      }
    });
  }

  /**
   * Map a keyCode to a cardinal direction string.
   * Supports both arrow keys and WASD.
   * @param {number} keyCode
   * @returns {string|null}
   */
  _keyCodeToDirection(keyCode) {
    switch (keyCode) {
      case 38: // UP arrow
      case 87: // W
        return 'up';
      case 40: // DOWN arrow
      case 83: // S
        return 'down';
      case 37: // LEFT arrow
      case 65: // A
        return 'left';
      case 39: // RIGHT arrow
      case 68: // D
        return 'right';
      default:
        return null;
    }
  }

  /**
   * Create walking and idle animations based on the player spritesheet layout.
   *
   * Sheet layout (32×32 frames, 4 columns × 4 rows = 128×128):
   *   Rows:    0 = Down, 1 = Left, 2 = Right, 3 = Up
   *   Columns: 0 = neutral (idle), 1 = step, 2 = neutral, 3 = step
   * Phaser numbers frames row-major, so frame = row * FRAMES_PER_ROW + column. Walking
   * plays the whole row (neutral → step → neutral → step); idle holds column 0.
   */
  _createAnimations() {
    if (!this.scene.anims) return;

    const directions = ['down', 'left', 'right', 'up'];
    const spriteKey = this.sprite.texture ? this.sprite.texture.key : 'player';

    directions.forEach((dir, rowIndex) => {
      const walkKey = `player-walk-${dir}`;
      const idleKey = `player-idle-${dir}`;
      const rowStart = rowIndex * FRAMES_PER_ROW;

      // Only create if not already registered
      if (!this.scene.anims.exists(walkKey)) {
        this.scene.anims.create({
          key: walkKey,
          frames: this.scene.anims.generateFrameNumbers(spriteKey, {
            start: rowStart,
            end: rowStart + FRAMES_PER_ROW - 1
          }),
          frameRate: this._animFrameRate,
          repeat: -1
        });
      }

      if (!this.scene.anims.exists(idleKey)) {
        this.scene.anims.create({
          key: idleKey,
          frames: [{ key: spriteKey, frame: rowStart }],
          frameRate: 1,
          repeat: 0
        });
      }
    });
  }

  /**
   * Process movement input each frame.
   * Uses the key stack for most-recent-key-priority resolution.
   * Passes flat velocity values to sprite.setVelocity() — no deltaTime multiplication.
   *
   * @param {Phaser.Types.Input.Keyboard.CursorKeys} cursors - Arrow key input (unused for tracking but kept for API compat)
   * @param {object} wasd - WASD key objects (unused for tracking but kept for API compat)
   */
  update(cursors, wasd) {
    if (this._frozen) {
      return;
    }

    // Determine active direction from the key stack (most recent held key wins)
    const activeDir = this._getActiveDirection(cursors, wasd);

    if (activeDir) {
      this._facing = activeDir;

      // Set velocity — exactly one non-zero component (cardinal only)
      switch (activeDir) {
        case 'up':
          this.sprite.setVelocity(0, -this.speed);
          break;
        case 'down':
          this.sprite.setVelocity(0, this.speed);
          break;
        case 'left':
          this.sprite.setVelocity(-this.speed, 0);
          break;
        case 'right':
          this.sprite.setVelocity(this.speed, 0);
          break;
      }

      // Play walk animation
      const walkKey = `player-walk-${activeDir}`;
      if (this.sprite.anims && typeof this.sprite.anims.play === 'function') {
        this.sprite.anims.play(walkKey, true);
      }
    } else {
      // No direction held — stop and show idle frame
      this.sprite.setVelocity(0, 0);

      const idleKey = `player-idle-${this._facing}`;
      if (this.sprite.anims && typeof this.sprite.anims.play === 'function') {
        this.sprite.anims.play(idleKey, true);
      }
    }

    // Two-sided horizontal clamp. Net effect:
    //   sprite.x = Math.min(Math.max(sprite.x, minX), maxX)
    // with the directional velocity zeroed at the respective edge. A no-op while
    // bounds are the defaults (-Infinity / +Infinity).
    this._applyHorizontalClamp();

    // Two-sided vertical clamp keeping the player's feet on the walkable floor band
    // (feet may not step above the floor top onto the back wall, nor below the floor
    // bottom). A no-op while bounds are the defaults.
    this._applyVerticalClamp();
  }

  /**
   * Set the horizontal clamp bounds. `maxX` may be updated at runtime as the final
   * segment's right edge becomes known (Req 13.3). GameScene pins the physics world
   * left/right bounds to the same [minX, maxX] (that wiring lives in GameScene, not
   * here). Pass undefined for a bound to leave it unchanged.
   *
   * @param {number} [minX] - Left clamp bound (start-map floor left edge)
   * @param {number} [maxX] - Right clamp bound (final segment floor right edge)
   */
  setBounds(minX, maxX) {
    if (typeof minX === 'number') this.minX = minX;
    if (typeof maxX === 'number') this.maxX = maxX;
  }

  /**
   * Set the vertical clamp bounds for the player's feet (world Y). The sprite's feet
   * origin means `sprite.y` is the feet position, so these are compared directly.
   * `minFeetY` is the walkable floor's top edge; `maxFeetY` is its bottom edge. Pass
   * undefined for a bound to leave it unchanged.
   *
   * @param {number} [minFeetY] - Floor top edge (feet may not go above it).
   * @param {number} [maxFeetY] - Floor bottom edge (feet may not go below it).
   */
  setVerticalBounds(minFeetY, maxFeetY) {
    if (typeof minFeetY === 'number') this.minFeetY = minFeetY;
    if (typeof maxFeetY === 'number') this.maxFeetY = maxFeetY;
  }

  /**
   * Clamp the sprite's X into [minX, maxX] and zero the velocity component pushing
   * past the hit edge. Robust against mocks that lack a full physics body.
   */
  _applyHorizontalClamp() {
    if (this.sprite.x < this.minX) {
      this.sprite.x = this.minX;
      // Moving left into the edge — stop leftward velocity.
      if ((this.sprite.body?.velocity?.x ?? 0) < 0) {
        this._zeroVelocityX();
      }
    } else if (this.sprite.x > this.maxX) {
      this.sprite.x = this.maxX;
      // Moving right into the edge — stop rightward velocity.
      if ((this.sprite.body?.velocity?.x ?? 0) > 0) {
        this._zeroVelocityX();
      }
    }
  }

  /**
   * Zero only the X velocity component, using whichever sprite API is available
   * (keeps the file's existing setVelocity usage working with partial mocks).
   */
  _zeroVelocityX() {
    if (typeof this.sprite.setVelocityX === 'function') {
      this.sprite.setVelocityX(0);
    } else if (typeof this.sprite.setVelocity === 'function') {
      const y = this.sprite.body?.velocity?.y ?? 0;
      this.sprite.setVelocity(0, y);
    }
  }

  /**
   * Clamp the sprite's feet Y into [minFeetY, maxFeetY] and zero the velocity
   * component pushing past the hit edge. Robust against mocks that lack a full
   * physics body. Symmetric to {@link _applyHorizontalClamp}.
   */
  _applyVerticalClamp() {
    if (this.sprite.y < this.minFeetY) {
      this.sprite.y = this.minFeetY;
      // Moving up into the floor's top edge — stop upward velocity.
      if ((this.sprite.body?.velocity?.y ?? 0) < 0) {
        this._zeroVelocityY();
      }
    } else if (this.sprite.y > this.maxFeetY) {
      this.sprite.y = this.maxFeetY;
      // Moving down into the floor's bottom edge — stop downward velocity.
      if ((this.sprite.body?.velocity?.y ?? 0) > 0) {
        this._zeroVelocityY();
      }
    }
  }

  /**
   * Zero only the Y velocity component, using whichever sprite API is available.
   */
  _zeroVelocityY() {
    if (typeof this.sprite.setVelocityY === 'function') {
      this.sprite.setVelocityY(0);
    } else if (typeof this.sprite.setVelocity === 'function') {
      const x = this.sprite.body?.velocity?.x ?? 0;
      this.sprite.setVelocity(x, 0);
    }
  }

  /**
   * Get the active direction from the key stack, filtered by currently held keys.
   * Returns the most recently pressed key that is still held down.
   *
   * @param {object} cursors - Phaser cursor keys
   * @param {object} wasd - WASD key objects
   * @returns {string|null}
   */
  _getActiveDirection(cursors, wasd) {
    // Build set of currently held directions from the actual key state
    const held = new Set();

    if (cursors) {
      if (cursors.up && cursors.up.isDown) held.add('up');
      if (cursors.down && cursors.down.isDown) held.add('down');
      if (cursors.left && cursors.left.isDown) held.add('left');
      if (cursors.right && cursors.right.isDown) held.add('right');
    }

    if (wasd) {
      if (wasd.up && wasd.up.isDown) held.add('up');
      if (wasd.down && wasd.down.isDown) held.add('down');
      if (wasd.left && wasd.left.isDown) held.add('left');
      if (wasd.right && wasd.right.isDown) held.add('right');
    }

    if (held.size === 0) return null;

    // Walk the stack from most recent to find a key that is still held
    for (let i = this._keyStack.length - 1; i >= 0; i--) {
      if (held.has(this._keyStack[i])) {
        return this._keyStack[i];
      }
    }

    // Fallback: if held keys exist but aren't tracked in stack (edge case),
    // pick the first held direction
    return held.values().next().value;
  }

  /**
   * Disable input processing and stop the player immediately.
   */
  freeze() {
    this._frozen = true;
    this.sprite.setVelocity(0, 0);

    // Show idle frame for current facing direction
    const idleKey = `player-idle-${this._facing}`;
    if (this.sprite.anims && typeof this.sprite.anims.play === 'function') {
      this.sprite.anims.play(idleKey, true);
    }
  }

  /**
   * Re-enable input processing.
   */
  unfreeze() {
    this._frozen = false;
  }

  /**
   * Get the direction the player is currently facing.
   * @returns {string} 'up' | 'down' | 'left' | 'right'
   */
  getFacingDirection() {
    return this._facing;
  }
}
