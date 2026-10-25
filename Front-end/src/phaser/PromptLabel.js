/**
 * PromptLabel — the floating `[E]` interaction prompt pinned above the player.
 *
 * A thin wrapper around a single Phaser `Text` object showing `[E]`. It owns only its
 * own presentation: creation at a fixed overhead depth, show/hide, and per-frame
 * repositioning above the player's top edge. The VISIBILITY RULE itself — "visible iff
 * the player overlaps an interaction zone and no overlay is open" — is NOT decided here;
 * it is applied by `GameScene.update()` which calls
 * `promptLabel.setVisible(interactionManager.isPlayerOverlappingZone(player) && !overlayOpen)`
 * (Req 8.1, 8.3, 8.4). Keeping the predicate in the scene leaves this class pure
 * presentation and trivially mock-testable.
 *
 * Depth is fixed at the overhead band (`>= 10000`) so Y-sorted decor never occludes the
 * prompt (Req 8.5). The label follows the player at a fixed vertical offset so it always
 * floats the same distance above the sprite's head (Req 8.2).
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

/** Overhead depth band — matches `GameScene.OVERHEAD_DEPTH` so decor never occludes. */
const OVERHEAD_DEPTH = 10000;

/** Default pixels from the player's top edge to the prompt (negative = above). */
const DEFAULT_OFFSET_Y = -8;

export default class PromptLabel {
  /**
   * @param {Phaser.Scene} scene - The game scene (used to create the Text object).
   * @param {number} [offsetY=-8] - Pixels above the player's TOP edge to place the
   *   prompt. Negative values sit above the sprite; the offset is constant so the label
   *   keeps a fixed distance above the player's head as the player moves (Req 8.2).
   */
  constructor(scene, offsetY = DEFAULT_OFFSET_Y) {
    this.scene = scene;

    /** @type {number} Fixed vertical offset from the player's top edge. */
    this.offsetY = Number.isFinite(offsetY) ? offsetY : DEFAULT_OFFSET_Y;

    /** @type {number} Fixed overhead depth (Req 8.5). */
    this.depth = OVERHEAD_DEPTH;

    /**
     * The `[E]` text object. Created hidden; GameScene toggles it via setVisible per
     * the visibility rule each frame.
     * @type {Phaser.GameObjects.Text|null}
     */
    this.label = this._createLabel();
  }

  /**
   * Create the `[E]` Text object at the overhead depth, centered on its origin, hidden
   * by default. Returns null if the scene cannot create text (keeps the manager inert
   * rather than throwing in a headless/mock context).
   *
   * @returns {Phaser.GameObjects.Text|null}
   * @private
   */
  _createLabel() {
    if (!this.scene || !this.scene.add || typeof this.scene.add.text !== 'function') {
      return null;
    }

    const label = this.scene.add.text(0, 0, '[E]', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#000000',
      align: 'center'
    });

    if (label && typeof label.setOrigin === 'function') {
      label.setOrigin(0.5, 1); // bottom-center: the prompt sits ABOVE its anchor point
    }
    if (label && typeof label.setDepth === 'function') {
      label.setDepth(this.depth); // overhead band — never occluded (Req 8.5)
    }
    if (label && typeof label.setVisible === 'function') {
      label.setVisible(false); // hidden until the scene's visibility rule shows it
    }

    return label;
  }

  /**
   * Show or hide the prompt. GameScene calls this each frame with the result of the
   * visibility predicate (`overlapsZone && !overlayOpen`). No-op if the label failed
   * to create.
   *
   * @param {boolean} visible
   */
  setVisible(visible) {
    if (this.label && typeof this.label.setVisible === 'function') {
      this.label.setVisible(!!visible);
    }
  }

  /**
   * Reposition the prompt above the player's top edge, preserving the fixed offset as
   * the player moves (Req 8.2). The player's top edge is `player.y - displayHeight`
   * when the sprite uses a feet origin `(0.5, 1)` (as the player does); when a
   * `displayHeight` is unavailable the raw `player.y` is used as the anchor. No-op for
   * missing label or player.
   *
   * @param {{ x: number, y: number, displayHeight?: number }} player
   */
  follow(player) {
    if (!this.label || !player) {
      return;
    }

    const px = Number.isFinite(player.x) ? player.x : 0;
    const py = Number.isFinite(player.y) ? player.y : 0;
    const topY = Number.isFinite(player.displayHeight) ? py - player.displayHeight : py;
    const targetY = topY + this.offsetY;

    if (typeof this.label.setPosition === 'function') {
      this.label.setPosition(px, targetY);
    } else {
      this.label.x = px;
      this.label.y = targetY;
    }
  }
}
