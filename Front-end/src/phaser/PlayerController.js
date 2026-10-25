/**
 * PlayerController — encapsulates player movement logic.
 *
 * Cardinal-only movement with most-recent-key-priority resolution.
 * Passes flat velocity values to sprite.setVelocity() — Phaser Arcade Physics
 * handles frame-rate-independent integration internally (do NOT multiply by deltaTime).
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */
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
    this._animFrameRate = 8;

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
   * Row 0: Down, Row 1: Left, Row 2: Right, Row 3: Up
   * 3 frames per row minimum (idle + 2 walk frames)
   */
  _createAnimations() {
    if (!this.scene.anims) return;

    const directions = ['down', 'left', 'right', 'up'];
    const spriteKey = this.sprite.texture ? this.sprite.texture.key : 'player';

    directions.forEach((dir, rowIndex) => {
      const walkKey = `player-walk-${dir}`;
      const idleKey = `player-idle-${dir}`;

      // Only create if not already registered
      if (!this.scene.anims.exists(walkKey)) {
        this.scene.anims.create({
          key: walkKey,
          frames: this.scene.anims.generateFrameNumbers(spriteKey, {
            start: rowIndex * 3 + 1,
            end: rowIndex * 3 + 2
          }),
          frameRate: this._animFrameRate,
          repeat: -1
        });
      }

      if (!this.scene.anims.exists(idleKey)) {
        this.scene.anims.create({
          key: idleKey,
          frames: [{ key: spriteKey, frame: rowIndex * 3 }],
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
