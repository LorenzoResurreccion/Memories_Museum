/**
 * SegmentManager — generates, positions, counts, and recycles Hallway_Segments,
 * bounded on the right at Final_Segment_Index (the segment holding the last
 * authored memory). On build, zone ordering + memory resolution (Zone_Index,
 * Memory_Index, authored-or-future payload) are delegated to the injected
 * `buildSegment` builder — see design "Zone ordering and memory resolution".
 *
 * Pure-logic-first: all index / offset / window arithmetic is deterministic and
 * unit/property-testable without a live Phaser scene. The only scene-touching
 * work (building sprites, bodies, zones; releasing them) is delegated to the
 * injected `buildSegment` / `releaseSegment` callbacks, so the manager can be
 * exercised with mocks without a live Phaser scene.
 *
 * Requirements: 3.1–3.9, 4.1–4.7, 5.1, 5.5, 5.6, 10.4, 10.6, 12.1–12.7, 13.1, 13.2, 13.8
 */

/** Width of a map / segment in px: 58 tiles * 16px = 928. */
const DEFAULT_SEGMENT_WIDTH_PX = 58 * 16;

/**
 * @typedef {object} Segment
 * @property {number} index         the Segment_Index this segment occupies
 * @property {number} worldOffsetX  world X of the segment's left edge
 * @property {*} [*]                any scene-owned handles (sprites/bodies/zones)
 *   returned by `buildSegment`; opaque to the manager and passed back verbatim to
 *   `releaseSegment` on recycle.
 */

export default class SegmentManager {
  /**
   * @param {object} deps
   * @param {number} deps.startRightEdgeX  world X of the start-map floor right edge
   *   (the left edge of segment index 0 — a flush seam with zero gap, Req 3.1).
   * @param {number} [deps.segmentWidthPx=928]  58 * 16 = 928.
   * @param {number} [deps.authoredMemoryCount]  N — count of Memories_Manifest entries.
   *   `finalSegmentIndex` is derived from it as `floor((N-1)/6)` for `N >= 1`, else 0
   *   (Req 13.2), unless `deps.finalSegmentIndex` is supplied explicitly.
   * @param {number} [deps.finalSegmentIndex]  optional explicit right bound; when
   *   omitted it is derived from `authoredMemoryCount`. No index > this is generated
   *   (Req 3.3, 13.1).
   * @param {number} [deps.maxLoaded=3]  max concurrently instantiated segments (Req 3.6).
   * @param {number} [deps.generateAheadPx=928]  look-ahead distance that triggers
   *   right-generation (Req 3.2) and the recycle-behind threshold (Req 3.7).
   * @param {(index:number, worldOffsetX:number) => Segment} deps.buildSegment  builds a
   *   segment's sprites/bodies/zones (incl. zone ordering + memory resolution) and
   *   returns an opaque Segment handle. May return a falsy value / throw to signal
   *   build failure (Req 3.9).
   * @param {(segment:Segment) => void} deps.releaseSegment  disposes a segment's
   *   Layer2 sprites, collision bodies, and zones on recycle (Req 3.8).
   */
  constructor(deps = {}) {
    const {
      startRightEdgeX,
      segmentWidthPx = DEFAULT_SEGMENT_WIDTH_PX,
      authoredMemoryCount,
      finalSegmentIndex,
      maxLoaded = 3,
      generateAheadPx = DEFAULT_SEGMENT_WIDTH_PX,
      buildSegment,
      releaseSegment
    } = deps;

    /** @type {number} World X of segment index 0's left edge. */
    this.startRightEdgeX = Number.isFinite(startRightEdgeX) ? startRightEdgeX : 0;

    /** @type {number} */
    this.segmentWidthPx =
      Number.isFinite(segmentWidthPx) && segmentWidthPx > 0
        ? segmentWidthPx
        : DEFAULT_SEGMENT_WIDTH_PX;

    /** @type {number} */
    this.maxLoaded = Number.isFinite(maxLoaded) && maxLoaded > 0 ? maxLoaded : 3;

    /** @type {number} */
    this.generateAheadPx = Number.isFinite(generateAheadPx)
      ? generateAheadPx
      : this.segmentWidthPx;

    /** @type {(index:number, worldOffsetX:number) => Segment} */
    this._buildSegment = typeof buildSegment === 'function' ? buildSegment : null;

    /** @type {(segment:Segment) => void} */
    this._releaseSegment = typeof releaseSegment === 'function' ? releaseSegment : null;

    // finalSegmentIndex: explicit injection wins; otherwise derive from N.
    if (Number.isFinite(finalSegmentIndex)) {
      /** @type {number} */
      this._finalSegmentIndex = Math.max(0, Math.floor(finalSegmentIndex));
    } else {
      const n = Number.isFinite(authoredMemoryCount) ? authoredMemoryCount : 0;
      this._finalSegmentIndex = n >= 1 ? Math.floor((n - 1) / 6) : 0;
    }

    /**
     * Instantiated segments by index. Invariant: `size <= maxLoaded` (Req 3.6).
     * @type {Map<number, Segment>}
     */
    this._loadedWindow = new Map();

    /** @type {number} Highest index ever generated; -1 before any generation. */
    this._maxGeneratedIndex = -1;

    /** @type {boolean} True if the last generation attempt failed (Req 3.9). */
    this._generationFailed = false;
  }

  /**
   * The rightmost segment index that can ever exist.
   * `floor((N-1)/6)` for `N >= 1`, else 0 (Req 13.2). When `N = 0` this is 0, so the
   * hallway is exactly one segment (index 0) whose 6 zones are all future zones, with
   * nothing generated to its right (Req 13.8).
   * @returns {number}
   */
  get finalSegmentIndex() {
    return this._finalSegmentIndex;
  }

  /**
   * Highest generated index + 1; 0 before any generation (Req 4.1, 4.6). Increments by
   * exactly 1 only on a strictly new maximum index (Req 4.2, 4.3); leftward
   * re-instantiation never changes it (Req 4.4). Capped at `finalSegmentIndex + 1`
   * (Req 4.7).
   * @returns {number}
   */
  get segmentCount() {
    return this._maxGeneratedIndex + 1;
  }

  /**
   * Instantiated segments by index (the Loaded_Window). `size <= maxLoaded` always.
   * @returns {Map<number, Segment>}
   */
  get loadedWindow() {
    return this._loadedWindow;
  }

  /**
   * True if the last generation attempt failed (Req 3.9). While true, the current
   * rightmost segment is retained and nothing is released.
   * @returns {boolean}
   */
  get generationFailed() {
    return this._generationFailed;
  }

  /**
   * World X of a segment index's left edge.
   * `worldOffsetForIndex(0) = startRightEdgeX` (flush seam, zero gap — Req 3.1);
   * `worldOffsetForIndex(n) = startRightEdgeX + n * segmentWidthPx` (Req 3.5).
   * @param {number} index
   * @returns {number}
   */
  worldOffsetForIndex(index) {
    return this.startRightEdgeX + index * this.segmentWidthPx;
  }

  /**
   * World X of a segment index's right edge (its left edge + one segment width).
   * @param {number} index
   * @returns {number}
   * @private
   */
  _rightEdgeForIndex(index) {
    return this.worldOffsetForIndex(index) + this.segmentWidthPx;
  }

  /**
   * Called each frame with the player's world X. Drives generate / recycle.
   *
   * Order of operations:
   * 1. Ensure segment index 0 always exists (the hallway has at least one segment).
   * 2. Right-generation: generate `maxGenerated + 1` only while
   *    `maxGenerated < finalSegmentIndex` AND `playerX >= rightmostRightEdge - generateAheadPx`
   *    (Req 3.2, 3.3, 3.4). Enforces `loadedWindow.size <= maxLoaded` by recycling the
   *    furthest-behind segment only when its right edge `<= playerX - segmentWidthPx`
   *    (Req 3.6, 3.7).
   * 3. Left re-instantiation: as the player walks back left, missing in-window indices
   *    are rebuilt in descending order via the same deterministic `worldOffsetForIndex`
   *    + build (Req 5.1, 5.6). Never holds an index < 0 (Req 5.5).
   *
   * @param {number} playerX  the player's world X this frame.
   */
  update(playerX) {
    const px = Number.isFinite(playerX) ? playerX : 0;

    // (1) The hallway always has at least segment index 0.
    if (this._maxGeneratedIndex < 0) {
      this._generateIndex(0);
      // If even index 0 failed to build, stop — generationFailed is set.
      if (this._maxGeneratedIndex < 0) {
        return;
      }
    }

    // (2) Right-generation loop: only toward the right, never past finalSegmentIndex.
    //     Guarded so a single frame with a large look-ahead can fill in needed
    //     segments while never exceeding the bound.
    while (
      !this._generationFailed &&
      this._maxGeneratedIndex < this._finalSegmentIndex &&
      px >= this._rightEdgeForIndex(this._maxGeneratedIndex) - this.generateAheadPx
    ) {
      const nextIndex = this._maxGeneratedIndex + 1;
      this._recycleBehind(px);
      // Respect the window cap: if we could not make room, defer generation.
      if (this._loadedWindow.size >= this.maxLoaded) {
        break;
      }
      const built = this._generateIndex(nextIndex);
      if (!built) {
        break; // Build failure — generationFailed set; retain rightmost (Req 3.9).
      }
    }

    // (3) Left re-instantiation: rebuild any missing in-window index the player is
    //     near, in descending order, down to (but never below) index 0 (Req 5.1, 5.5).
    this._reinstantiateLeft(px);
  }

  /**
   * Build and register a single segment at `index` via the injected `buildSegment`.
   * Updates `maxGeneratedIndex` only on a strictly new maximum (so `segmentCount`
   * increments by exactly 1 and never on left re-instantiation — Req 4.2, 4.3, 4.4).
   * On build failure (falsy return or throw) sets `generationFailed` and releases
   * nothing (Req 3.9).
   *
   * @param {number} index
   * @returns {Segment|null} the built segment, or null on failure.
   * @private
   */
  _generateIndex(index) {
    if (index < 0 || index > this._finalSegmentIndex) {
      return null; // Never generate below 0 or past the bound (Req 3.3, 5.5, 13.1).
    }

    // Already instantiated — nothing to build, not a failure.
    const existing = this._loadedWindow.get(index);
    if (existing) {
      return existing;
    }

    const worldOffsetX = this.worldOffsetForIndex(index);

    let segment;
    try {
      segment = this._buildSegment ? this._buildSegment(index, worldOffsetX) : null;
    } catch {
      segment = null;
    }

    if (!segment) {
      // Retain current rightmost; release nothing (Req 3.9).
      this._generationFailed = true;
      return null;
    }

    // Normalise the handle so recycle/offset logic can rely on these fields.
    if (!Number.isFinite(segment.index)) {
      segment.index = index;
    }
    if (!Number.isFinite(segment.worldOffsetX)) {
      segment.worldOffsetX = worldOffsetX;
    }

    this._loadedWindow.set(index, segment);
    this._generationFailed = false;

    // segmentCount increments by exactly 1 only on a strictly new max (Req 4.2–4.4),
    // and is kept <= finalSegmentIndex + 1 (Req 4.7).
    if (index > this._maxGeneratedIndex) {
      this._maxGeneratedIndex = Math.min(index, this._finalSegmentIndex);
    }

    return segment;
  }

  /**
   * Recycle the furthest-behind loaded segment to keep `loadedWindow.size <= maxLoaded`,
   * but only when that segment is fully behind the player — its right edge
   * `<= playerX - segmentWidthPx` (Req 3.6, 3.7). If nothing is eligible, keep all
   * (the window may momentarily sit at `maxLoaded`; generation waits — handled by the
   * caller). Index 0 is never recycled below, i.e. the start seam stays reachable.
   *
   * @param {number} playerX
   * @private
   */
  _recycleBehind(playerX) {
    while (this._loadedWindow.size >= this.maxLoaded) {
      // Furthest-behind = lowest index currently loaded.
      let lowest = Infinity;
      for (const idx of this._loadedWindow.keys()) {
        if (idx < lowest) {
          lowest = idx;
        }
      }
      if (!Number.isFinite(lowest)) {
        return;
      }

      const rightEdge = this._rightEdgeForIndex(lowest);
      // Only recycle when the segment is a full segment-width behind the player.
      if (rightEdge > playerX - this.segmentWidthPx) {
        return; // Nothing eligible — keep all.
      }

      const segment = this._loadedWindow.get(lowest);
      this._loadedWindow.delete(lowest);
      this._releaseSegmentSafely(segment);
    }
  }

  /**
   * Rebuild any missing segment the player is currently near as they walk back left,
   * in descending index order, using the same deterministic offset + build so a
   * re-instantiated segment at the same index resolves identically (Req 5.1, 5.6).
   * Never rebuilds an index < 0 (Req 5.5) or > the max already generated (we only
   * restore previously-generated segments, never grow the right bound here).
   *
   * @param {number} playerX
   * @private
   */
  _reinstantiateLeft(playerX) {
    if (this._generationFailed || this._maxGeneratedIndex < 0) {
      return;
    }

    // Which segment index does the player currently stand within (relative to seg 0)?
    const rel = playerX - this.startRightEdgeX;
    let playerIndex = Math.floor(rel / this.segmentWidthPx);
    if (playerIndex < 0) {
      playerIndex = 0; // Player is on the start map / left of seg 0.
    }
    if (playerIndex > this._maxGeneratedIndex) {
      playerIndex = this._maxGeneratedIndex;
    }

    // Rebuild the player's index and its immediate neighbours (within the window and
    // the generated range) in descending order, making room via recycling.
    for (let index = playerIndex; index >= 0 && index > playerIndex - this.maxLoaded; index--) {
      if (this._loadedWindow.has(index)) {
        continue;
      }
      this._recycleAhead(playerX);
      if (this._loadedWindow.size >= this.maxLoaded) {
        break;
      }
      this._generateIndex(index);
    }
  }

  /**
   * Recycle the furthest-ahead loaded segment (highest index) to make room when
   * walking left, but only when it is fully ahead of the player — its left edge
   * `>= playerX + segmentWidthPx`. Symmetric to {@link _recycleBehind}. The current
   * rightmost generated index is tracked by `maxGeneratedIndex`, so releasing an
   * ahead segment never lowers `segmentCount` (Req 4.4).
   *
   * @param {number} playerX
   * @private
   */
  _recycleAhead(playerX) {
    while (this._loadedWindow.size >= this.maxLoaded) {
      let highest = -Infinity;
      for (const idx of this._loadedWindow.keys()) {
        if (idx > highest) {
          highest = idx;
        }
      }
      if (!Number.isFinite(highest)) {
        return;
      }

      const leftEdge = this.worldOffsetForIndex(highest);
      if (leftEdge < playerX + this.segmentWidthPx) {
        return; // Not fully ahead — keep all.
      }

      const segment = this._loadedWindow.get(highest);
      this._loadedWindow.delete(highest);
      this._releaseSegmentSafely(segment);
    }
  }

  /**
   * Call the injected `releaseSegment` defensively (never throw out of update).
   * @param {Segment} segment
   * @private
   */
  _releaseSegmentSafely(segment) {
    if (!segment || !this._releaseSegment) {
      return;
    }
    try {
      this._releaseSegment(segment);
    } catch {
      // Releasing must never crash the frame loop.
    }
  }
}
