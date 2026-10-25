/**
 * CollisionBuilder — builds static AABB bodies from per-tile collision shapes.
 *
 * Translates the per-tile collision object groups embedded in the `museum_tileset`
 * and `museum_decor` tilesets into arcade-compatible blocking regions. The chosen
 * approach is **per-collidable-tile static arcade bodies**: for each collidable
 * tile in a placed layer, an invisible static body sized to that tile's
 * axis-aligned bounding box (Collision_AABB) is added to an injected static group.
 * There is no dedicated collision tile layer (Req 6.6); collision is derived purely
 * from the tileset tile definitions (Req 6.1).
 *
 * The two pure helpers — {@link CollisionBuilder#classifyTile} and
 * {@link CollisionBuilder#tileLocalAABB} — never touch the scene or group, so they
 * are testable without a live Phaser scene. {@link CollisionBuilder#buildForLayer}
 * uses `this.scene` / `this.group` to create the static bodies.
 *
 * GID decode note: `buildForLayer` masks the raw Tiled GID locally
 * (`frame = gid & 0x1FFFFFFF`) rather than importing `gidDecode` from
 * `GameScene.js`. This keeps the module free of GameScene's heavy import graph
 * (PlayerController / InteractionManager / EventBus / Phaser) so it imports cleanly in
 * tests under the existing `vi.mock('phaser', …)` pattern. The equivalent
 * `gidDecode` helper exists in `GameScene.js` if a caller prefers it.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8
 */
export default class CollisionBuilder {
  /**
   * @param {Phaser.Scene} scene - The game scene (used by buildForLayer only).
   * @param {Phaser.Physics.Arcade.StaticGroup} group - The static group that owns
   *   created collision bodies. The caller wires `physics.add.collider(player, group)`
   *   once against this group; individual bodies do not need per-body colliders.
   */
  constructor(scene, group) {
    this.scene = scene;
    this.group = group;
  }

  /**
   * Classify a single embedded-tileset tile definition by the presence of a
   * parseable collision object group.
   *
   * Returns `'collision'` ONLY when the tile carries an `objectgroup` with a
   * non-empty `objects` array AND at least one object yields a valid AABB.
   * Returns `'floor'` when the object group is absent, empty, malformed, or
   * otherwise unparseable (Req 6.2, 6.8). Never throws for any input
   * (null / undefined / garbage all classify as `'floor'`).
   *
   * @param {{ id?: number, objectgroup?: { objects?: Array<object> } }} tilesetTileData
   *   A single entry from `tileset.tiles[]`.
   * @returns {'floor'|'collision'}
   */
  classifyTile(tilesetTileData) {
    return this.tileLocalAABB(tilesetTileData) ? 'collision' : 'floor';
  }

  /**
   * Compute the axis-aligned bounding box (in tile-local pixels) enclosing every
   * collision shape defined on a tile. Rectangle objects use `x/y/width/height`;
   * polygon / polyline objects use the min/max of each point offset by the object's
   * `x/y`. When multiple objects are present, the returned AABB encloses all of them
   * (min of mins, max of maxes). Float coordinates are preserved (Req 6.4).
   *
   * Returns `null` for floor / unparseable / empty tiles. Never throws.
   *
   * @param {{ objectgroup?: { objects?: Array<object> } }} tilesetTileData
   * @returns {{ x: number, y: number, width: number, height: number }|null}
   */
  tileLocalAABB(tilesetTileData) {
    try {
      const objects =
        tilesetTileData &&
        tilesetTileData.objectgroup &&
        Array.isArray(tilesetTileData.objectgroup.objects)
          ? tilesetTileData.objectgroup.objects
          : null;

      if (!objects || objects.length === 0) {
        return null;
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let found = false;

      for (const obj of objects) {
        if (!obj || typeof obj !== 'object') {
          continue;
        }

        const points = Array.isArray(obj.polygon)
          ? obj.polygon
          : Array.isArray(obj.polyline)
            ? obj.polyline
            : null;

        if (points) {
          // Polygon / polyline: AABB over each point offset by the object origin.
          const ox = Number.isFinite(obj.x) ? obj.x : 0;
          const oy = Number.isFinite(obj.y) ? obj.y : 0;
          for (const pt of points) {
            if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
              continue;
            }
            const px = ox + pt.x;
            const py = oy + pt.y;
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
            found = true;
          }
        } else if (
          Number.isFinite(obj.x) &&
          Number.isFinite(obj.y) &&
          Number.isFinite(obj.width) &&
          Number.isFinite(obj.height) &&
          obj.width > 0 &&
          obj.height > 0
        ) {
          // Rectangle: x/y top-left, width/height extent.
          const x0 = obj.x;
          const y0 = obj.y;
          const x1 = obj.x + obj.width;
          const y1 = obj.y + obj.height;
          if (x0 < minX) minX = x0;
          if (y0 < minY) minY = y0;
          if (x1 > maxX) maxX = x1;
          if (y1 > maxY) maxY = y1;
          found = true;
        }
        // Any other object shape (point, ellipse, zero-size rect) is ignored.
      }

      if (!found || maxX <= minX || maxY <= minY) {
        return null;
      }

      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      };
    } catch {
      // Defensive: any unexpected structure classifies as floor (Req 6.8).
      return null;
    }
  }

  /**
   * For each collidable tile in a placed finite tile layer, add an invisible static
   * arcade body positioned at the segment's world offset.
   *
   * Signature choice: the first parameter is the **layer object** carrying `data`
   * (flat `width*height` GID array), `width`, and `height`. (This matches the
   * task's literal `(layerData, tileset, worldOffsetX)` signature when `layerData`
   * is read as the layer object.)
   *
   * For each cell `i`: the raw GID is masked to a frame (`gid & 0x1FFFFFFF`); a
   * frame `<= 0` is an empty cell and skipped. The tile's local id is
   * `frame - tileset.firstgid`; the matching definition is looked up in
   * `tileset.tiles` by `id`. A cell with no matching collision definition is a
   * plain floor tile and creates no body (Req 6.2). For a collidable tile, a body
   * is created at `worldOffsetX + col*16 + localAABB.x` / `row*16 + localAABB.y`,
   * sized `localAABB.width × localAABB.height`, added to the injected static group,
   * and made invisible (Req 6.3, 6.7). A bad / unparseable tile is classified floor
   * and skipped; building never throws (Req 6.8).
   *
   * The caller wires `physics.add.collider(player, group)` once against the group
   * (Req 6.5); this method only populates the group.
   *
   * @param {{ data: number[], width: number, height: number }} layer - The finite
   *   tile layer object (flat `data`, `width`, `height`).
   * @param {{ firstgid: number, tiles?: Array<{ id: number, objectgroup?: object }> }} tileset
   *   The embedded tileset carrying per-tile collision definitions.
   * @param {number} worldOffsetX - The segment's world X offset in pixels.
   * @returns {Phaser.Physics.Arcade.Sprite[]} The created bodies (so the caller /
   *   SegmentManager can release them on recycle).
   */
  buildForLayer(layer, tileset, worldOffsetX) {
    const created = [];

    if (
      !layer ||
      !Array.isArray(layer.data) ||
      !Number.isFinite(layer.width) ||
      !tileset ||
      !Number.isFinite(tileset.firstgid)
    ) {
      return created;
    }

    const width = layer.width;
    const offsetX = Number.isFinite(worldOffsetX) ? worldOffsetX : 0;
    const firstgid = tileset.firstgid;
    const tiles = Array.isArray(tileset.tiles) ? tileset.tiles : [];

    for (let i = 0; i < layer.data.length; i++) {
      const gid = layer.data[i];
      if (!Number.isFinite(gid)) {
        continue;
      }

      // Mask off the Tiled flip flags to recover the real frame index.
      const frame = gid & 0x1fffffff;
      if (frame <= 0) {
        continue; // Empty cell.
      }

      const localId = frame - firstgid;
      const tileDef = tiles.find((t) => t && t.id === localId);
      if (!tileDef) {
        continue; // Plain floor tile (no collision definition).
      }

      const localAABB = this.tileLocalAABB(tileDef);
      if (!localAABB) {
        continue; // Floor / unparseable — no body (Req 6.8).
      }

      const col = i % width;
      const row = Math.floor(i / width);

      const worldX = offsetX + col * 16 + localAABB.x;
      const worldY = row * 16 + localAABB.y;

      const body = this._createBody(worldX, worldY, localAABB.width, localAABB.height);
      if (body) {
        created.push(body);
      }
    }

    return created;
  }

  /**
   * Create a single invisible static arcade body at a world-space top-left corner,
   * sized `width × height`, and add it to the injected static group.
   *
   * The static group's `create(x, y)` places by center with the default (0.5, 0.5)
   * origin, so the center is offset from the given top-left by half the extents.
   * The body is sized to the AABB and refreshed so arcade physics uses the box.
   *
   * @param {number} x - World-space top-left X.
   * @param {number} y - World-space top-left Y.
   * @param {number} width
   * @param {number} height
   * @returns {Phaser.Physics.Arcade.Sprite|null}
   * @private
   */
  _createBody(x, y, width, height) {
    if (!this.group || typeof this.group.create !== 'function') {
      return null;
    }

    const centerX = x + width / 2;
    const centerY = y + height / 2;

    const body = this.group.create(centerX, centerY);
    if (!body) {
      return null;
    }

    if (typeof body.setVisible === 'function') {
      body.setVisible(false);
    } else {
      body.visible = false;
    }

    // Size the physics body to the AABB and re-sync the static body.
    if (typeof body.setSize === 'function') {
      body.setSize(width, height);
    }
    if (typeof body.setDisplaySize === 'function') {
      body.setDisplaySize(width, height);
    }
    if (body.body) {
      if (typeof body.body.setSize === 'function') {
        body.body.setSize(width, height);
      }
      if (typeof body.body.updateFromGameObject === 'function') {
        body.body.updateFromGameObject();
      }
    }

    return body;
  }
}
