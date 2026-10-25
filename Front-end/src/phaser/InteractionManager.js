/**
 * InteractionManager — owns the Open_Key (`E`) detection and `hotspot-activated`
 * emission for the Infinite Hallway.
 *
 * Responsibilities:
 * - Own the **open key `E`** and edge-detect it so exactly one activation fires per
 *   discrete press (the key must be released for ≥1 frame before it can fire again).
 *   Space / Enter / Esc are NEVER open keys here (Req 9.1, 9.2, 9.13).
 * - Register / release each segment's world-offset interaction zones. Zones are NOT
 *   parsed from Tiled custom properties — each zone arrives already carrying its
 *   resolved `{ zone, zoneIndex, memoryIndex, id, payload }` from the segment-build
 *   step (see `resolveZonePayload`). Zones are pooled with their segment and removed
 *   on recycle (Req 3.8).
 * - Report whether the player overlaps any registered zone (drives the Prompt_Label).
 * - Emit `hotspot-activated` with the overlapped zone's resolved payload on an `E`
 *   rising edge while unlocked and overlapping (Req 9.3). The payload is non-empty for
 *   both authored and future memories, so it opens an overlay and freezes the player.
 * - Provide a lock so no activation fires while an overlay is open (Req 9.5).
 *
 * Communication is EventBus-only; this manager never touches React (Req 9.14).
 *
 * Requirements: 8.1, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.13, 9.14
 */
export default class InteractionManager {
  /**
   * @param {Phaser.Scene} scene - The game scene (for input + overlap queries).
   * @param {object} eventBus - The EventBus singleton for emitting `hotspot-activated`.
   */
  constructor(scene, eventBus) {
    this.scene = scene;
    this.eventBus = eventBus;

    /** @type {boolean} Locked while an overlay is open — no activation fires. */
    this._locked = false;

    /** @type {boolean} Previous frame's E key state, for rising-edge detection. */
    this._openKeyWasDown = false;

    /**
     * Registered interaction zones. Each entry is a resolved zone descriptor:
     * `{ zone, zoneIndex, memoryIndex, id, payload }`, where `zone` is the
     * world-offset Phaser overlap zone and `payload` is `{ id, text, imageUrl }`.
     * @type {Array<{ zone: object, zoneIndex: number, memoryIndex: number, id: string, payload: { id: string, text: string[], imageUrl: string|null } }>}
     */
    this._zones = [];
  }

  /**
   * Register a segment's zones (already world-offset and resolved). Each zone carries
   * its `{ zoneIndex, memoryIndex, id, payload }` from the segment-build step — manifest
   * resolution happened there, not here.
   *
   * @param {Array<object>} zones - resolved zone descriptors to add.
   */
  addZones(zones) {
    if (!Array.isArray(zones)) {
      return;
    }
    for (const z of zones) {
      if (z && z.zone) {
        this._zones.push(z);
      }
    }
  }

  /**
   * Remove a segment's zones on recycle (Req 3.8). Removal is by identity: each zone
   * descriptor passed here is spliced out of the registry if present.
   *
   * @param {Array<object>} zones - the exact zone descriptors previously added.
   */
  removeZones(zones) {
    if (!Array.isArray(zones)) {
      return;
    }
    for (const z of zones) {
      const idx = this._zones.indexOf(z);
      if (idx !== -1) {
        this._zones.splice(idx, 1);
      }
    }
  }

  /**
   * @param {Phaser.Physics.Arcade.Sprite} player
   * @returns {boolean} true if the player overlaps any registered zone. Drives the
   *   Prompt_Label visibility rule (Req 8.1, 8.3, 8.4). Never throws for garbage input.
   */
  isPlayerOverlappingZone(player) {
    return this._findOverlappingZone(player) !== null;
  }

  /**
   * Each frame: if unlocked AND the `E` key is on a rising edge AND the player overlaps
   * a zone, emit `hotspot-activated` with that zone's resolved payload (Req 9.3). The
   * edge detection guarantees at most one emit per discrete press cycle; the key must be
   * released for at least one frame before another emit can fire. No emit occurs on
   * Space / Enter / Esc (those keys are simply never read here — Req 9.2), when the
   * player overlaps no zone (Req 9.4), or while locked (Req 9.5).
   *
   * @param {Phaser.Physics.Arcade.Sprite} player
   */
  checkInteraction(player) {
    // Always sample the key so edge state stays consistent even while locked; a press
    // that starts during a lock must be released before it can fire after unlock.
    const openKeyDown = this._isOpenKeyDown();
    const risingEdge = openKeyDown && !this._openKeyWasDown;
    this._openKeyWasDown = openKeyDown;

    if (this._locked) {
      return; // No activation while an overlay is open (Req 9.5).
    }

    if (!risingEdge) {
      return; // Only fire on the E rising edge (Req 9.3). Held E does not re-fire.
    }

    const match = this._findOverlappingZone(player);
    if (!match) {
      return; // No zone under the player — nothing to activate (Req 9.4).
    }

    // Emit the resolved payload. Both authored and future payloads are non-empty, so
    // the overlay opens and the player freezes (Req 12.4, 12.5, 12.6, 13.5).
    const payload = match.payload || {};
    this.eventBus.emit('hotspot-activated', {
      id: payload.id ?? match.id,
      text: payload.text ?? [],
      imageUrl: payload.imageUrl ?? null
    });
  }

  /**
   * Lock or unlock activation. When locked, {@link checkInteraction} emits nothing
   * (used while an overlay is open). Called by GameScene on `hotspot-activated`
   * (lock) and `dialogue-dismissed` / `image-dismissed` (unlock).
   *
   * @param {boolean} locked
   */
  setLocked(locked) {
    this._locked = !!locked;
  }

  /**
   * Find the first registered zone the player overlaps, or null. Uses the scene's
   * arcade `physics.overlap` against each zone's physics body.
   *
   * @param {Phaser.Physics.Arcade.Sprite} player
   * @returns {object|null} the overlapping zone descriptor, or null.
   * @private
   */
  _findOverlappingZone(player) {
    if (!player || !this.scene || !this.scene.physics || typeof this.scene.physics.overlap !== 'function') {
      return null;
    }
    for (const z of this._zones) {
      if (z && z.zone && this.scene.physics.overlap(player, z.zone)) {
        return z;
      }
    }
    return null;
  }

  /**
   * @returns {boolean} whether the `E` open key is currently down. Resolves the key via
   *   the scene keyboard (`addKey`). Returns false if the keyboard is unavailable.
   * @private
   */
  _isOpenKeyDown() {
    const keyboard = this.scene?.input?.keyboard;
    if (!keyboard || typeof keyboard.addKey !== 'function') {
      return false;
    }
    const eKey = keyboard.addKey('E');
    return !!(eKey && eKey.isDown);
  }
}
