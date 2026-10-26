/**
 * paintings.js — the static Painting_Image_Source for the Wall Paintings feature.
 *
 * This is a pure, static ES module, parallel to `src/data/memories.js`: it performs
 * NO network access and NO fetch. It maps each authored Memory_Index to the pixel-art
 * image shown inside that memory's framed canvas, and is imported directly at
 * build-segment time (never fetched) — Requirement 5.5.
 *
 * Entries are PLACEHOLDERS until real pixel art is authored. Swapping in real art
 * later requires editing ONLY the references here (the per-entry `key`/`url`), adding
 * the asset, and loading its texture key in `GameScene.preload()` — with NO change to
 * zone/segment/resolution logic (Requirement 5.3). A null/absent entry, a missing
 * `key`, a Future_Painting (Memory_Index >= N), or a failed-to-load texture all resolve
 * to `PAINTING_PLACEHOLDER_KEY`.
 *
 * @typedef {object} PaintingEntry
 * @property {string} key       Phaser texture key loaded in GameScene.preload()
 * @property {string|null} url  optional external URL (heavy media kept out of the bundle)
 */

/**
 * PAINTING_PLACEHOLDER_KEY — texture key used when a Memory_Index has no painting, its
 * entry/key is missing, it is a Future_Painting, or its image failed to load. Names a
 * tiny bundled pixel texture loaded in `GameScene.preload()` (Requirement 5.1).
 * @type {string}
 */
export const PAINTING_PLACEHOLDER_KEY = 'painting_placeholder';

/**
 * PAINTINGS — the Painting_Image_Source.
 *
 * A plain object keyed by Memory_Index (0-based), holding exactly N authored entries
 * at contiguous indices `0 .. N-1`, matching the Memories_Manifest size (`MEMORIES` in
 * `src/data/memories.js`). Each entry's `key` is the texture key the scene renders.
 *
 * NOTE: These are PLACEHOLDER entries — every `key` is `PAINTING_PLACEHOLDER_KEY`. This
 * is a personal gift project, so the real pixel art is intentionally NOT authored here
 * yet. Replace each `key`/`url` with the real painting's texture key and (optionally)
 * external URL when the art is ready, keeping indices contiguous `0 .. N-1` so N stays
 * in sync with `MEMORIES`.
 *
 * @type {Record<number, PaintingEntry>}
 */
export const PAINTINGS = {
  0: { key: PAINTING_PLACEHOLDER_KEY, url: null },
  1: { key: PAINTING_PLACEHOLDER_KEY, url: null },
  2: { key: PAINTING_PLACEHOLDER_KEY, url: null },
  3: { key: PAINTING_PLACEHOLDER_KEY, url: null },
  4: { key: PAINTING_PLACEHOLDER_KEY, url: null },
  5: { key: PAINTING_PLACEHOLDER_KEY, url: null },
  6: { key: PAINTING_PLACEHOLDER_KEY, url: null },
  7: { key: PAINTING_PLACEHOLDER_KEY, url: null },
};
