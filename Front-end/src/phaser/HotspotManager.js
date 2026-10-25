/**
 * HotspotManager — loads memory hotspot zones from a Tiled object layer
 * and manages player interaction/activation.
 *
 * Responsibilities:
 * - Parse Tiled objects of type "memory_hotspot" from the object layer
 * - Create invisible Phaser arcade physics overlap zones for each hotspot
 * - Check player overlap + interaction key press to emit hotspot-activated events
 * - Provide a lock mechanism to prevent activation while an overlay is active
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
export default class HotspotManager {
  /**
   * @param {Phaser.Scene} scene - The game scene
   * @param {object} objectLayer - The Tiled object layer containing hotspot objects
   * @param {object} eventBus - The EventBus singleton for emitting events
   */
  constructor(scene, objectLayer, eventBus) {
    this.scene = scene;
    this.objectLayer = objectLayer;
    this.eventBus = eventBus;

    /** @type {boolean} */
    this._locked = false;

    /** @type {boolean} Track previous frame's Space key state for edge detection */
    this._spaceWasDown = false;

    /** @type {boolean} Track previous frame's Enter key state for edge detection */
    this._enterWasDown = false;

    /**
     * Array of loaded hotspot data, each with zone reference and parsed properties.
     * @type {Array<{ id: string, text: string[], imageUrl: string|null, zone: object }>}
     */
    this.hotspots = [];

    // Load hotspots on construction
    this.loadHotspots();
  }

  /**
   * Parse Tiled objects of type "memory_hotspot" from the object layer,
   * create invisible arcade physics overlap zones, and extract hotspot data.
   *
   * Skips hotspots missing required fields (id or text) with console.warn.
   */
  loadHotspots() {
    if (!this.objectLayer || !this.objectLayer.objects) {
      return;
    }

    const objects = this.objectLayer.objects.filter(
      (obj) => obj.type === 'memory_hotspot'
    );

    for (const obj of objects) {
      // Extract properties from the Tiled object's properties array
      const props = this._extractProperties(obj.properties);

      const id = props.id || null;
      const textRaw = props.text || null;
      const imageUrl = props.imageUrl || null;

      // Validate required fields
      if (!id) {
        console.warn(
          `HotspotManager: Skipping hotspot "${obj.name || 'unnamed'}" — missing required "id" property.`
        );
        continue;
      }

      if (!textRaw) {
        console.warn(
          `HotspotManager: Skipping hotspot "${obj.name || 'unnamed'}" (id: ${id}) — missing required "text" property.`
        );
        continue;
      }

      // Parse text as JSON string array
      let text;
      try {
        text = JSON.parse(textRaw);
        if (!Array.isArray(text)) {
          console.warn(
            `HotspotManager: Skipping hotspot "${obj.name || 'unnamed'}" (id: ${id}) — "text" is not a JSON array.`
          );
          continue;
        }
      } catch (e) {
        console.warn(
          `HotspotManager: Skipping hotspot "${obj.name || 'unnamed'}" (id: ${id}) — "text" is not valid JSON: ${e.message}`
        );
        continue;
      }

      // Create an invisible arcade physics zone at the hotspot position/size
      // Tiled objects use x/y as top-left corner; Phaser zones use center
      const centerX = obj.x + (obj.width / 2);
      const centerY = obj.y + (obj.height / 2);

      const zone = this.scene.add.zone(centerX, centerY, obj.width, obj.height);
      this.scene.physics.add.existing(zone, true); // true = static body

      this.hotspots.push({
        id,
        text,
        imageUrl,
        zone
      });
    }
  }

  /**
   * Check if the player is overlapping any hotspot zone and the interaction key
   * (Space or Enter) is pressed. If so, emit "hotspot-activated" via the EventBus.
   *
   * Does nothing if locked or if no overlap/key press.
   *
   * @param {Phaser.Physics.Arcade.Sprite} player - The player sprite
   */
  checkInteraction(player) {
    if (this._locked) {
      return;
    }

    // Check if Space or Enter was JUST pressed this frame (not held)
    const spaceKey = this.scene.input.keyboard.addKey('SPACE');
    const enterKey = this.scene.input.keyboard.addKey('ENTER');

    const spaceJustDown = spaceKey && spaceKey.isDown && !this._spaceWasDown;
    const enterJustDown = enterKey && enterKey.isDown && !this._enterWasDown;

    // Track previous state for next frame
    this._spaceWasDown = spaceKey ? spaceKey.isDown : false;
    this._enterWasDown = enterKey ? enterKey.isDown : false;

    const interactionPressed = spaceJustDown || enterJustDown;

    if (!interactionPressed) {
      return;
    }

    // Check overlap with each hotspot zone
    for (const hotspot of this.hotspots) {
      const overlapping = this.scene.physics.overlap(player, hotspot.zone);

      if (overlapping) {
        // Emit the activation event
        this.eventBus.emit('hotspot-activated', {
          id: hotspot.id,
          text: hotspot.text,
          imageUrl: hotspot.imageUrl
        });
        return; // Only activate one hotspot per interaction
      }
    }
  }

  /**
   * Lock or unlock hotspot activation.
   * When locked, checkInteraction() will do nothing (used while overlay is active).
   *
   * @param {boolean} locked - Whether to lock (true) or unlock (false)
   */
  setLocked(locked) {
    this._locked = locked;
  }

  /**
   * Extract properties from a Tiled object's properties array into a flat object.
   * Tiled stores custom properties as: [{ name, type, value }, ...]
   *
   * @param {Array<{name: string, type: string, value: any}>|undefined} properties
   * @returns {object}
   */
  _extractProperties(properties) {
    if (!properties || !Array.isArray(properties)) {
      return {};
    }

    const result = {};
    for (const prop of properties) {
      result[prop.name] = prop.value;
    }
    return result;
  }
}
