/**
 * paintings.js — the static Painting_Image_Source for the Wall Paintings feature.
 *
 * This is a pure, static ES module, parallel to `src/data/memories.js`: it performs
 * NO network access and NO fetch. It maps each authored Memory_Index to the pixel-art
 * image shown inside that memory's framed canvas, and is imported directly at
 * build-segment time (never fetched) — Requirement 5.5.
 *
 * Each entry names a per-memory texture `key` and its `url`, both derived so the index
 * is the single source of truth: `key` is `painting_NN` and `url` is `paintingUrl(NN)`
 * (built from `MEDIA_BASE_URL`, see `mediaBase.js`). The painting art lives in
 * `Memories/paintings/`, not the bundle. For a painting to actually render, its texture
 * must also be loaded under the same `key` in `GameScene.preload()` — the preload builds
 * that list from this same source, so keeping them in sync is automatic. A missing entry,
 * a Future_Painting (Memory_Index >= N), or a failed-to-load texture resolves to
 * `PAINTING_PLACEHOLDER_KEY`.
 *
 * @typedef {object} PaintingEntry
 * @property {string} key       Phaser texture key loaded in GameScene.preload()
 * @property {string|null} url  URL to the pixel art (served from Memories/, not bundled)
 */

import { paintingUrl } from './mediaBase.js';

/**
 * PAINTING_PLACEHOLDER_KEY — texture key used when a Memory_Index has no painting, its
 * entry/key is missing, it is a Future_Painting, or its image failed to load. Names a
 * tiny bundled pixel texture loaded in `GameScene.preload()` (Requirement 5.1).
 * @type {string}
 */
export const PAINTING_PLACEHOLDER_KEY = 'painting_placeholder';

/**
 * paintingKey — the texture key for a given Memory_Index (`painting_00`, `painting_01`, …).
 * @param {number} index
 * @returns {string}
 */
export function paintingKey(index) {
  return `painting_${String(index).padStart(2, '0')}`;
}

/**
 * PAINTINGS — the Painting_Image_Source.
 *
 * A plain object keyed by Memory_Index (0-based), holding exactly N authored entries at
 * contiguous indices `0 .. N-1`, matching the Memories_Manifest size (`MEMORIES` in
 * `src/data/memories.js`). Each entry's `key` is the texture key the scene renders and
 * its `url` is where that texture loads from (both derived from the index, so the index
 * stays the single source of truth). Keep indices contiguous `0 .. N-1` so N stays in
 * sync with `MEMORIES`.
 *
 * @type {Record<number, PaintingEntry>}
 */
export const PAINTINGS = {
  0: { key: paintingKey(0), url: paintingUrl(0) },
  1: { key: paintingKey(1), url: paintingUrl(1) },
  2: { key: paintingKey(2), url: paintingUrl(2) },
  3: { key: paintingKey(3), url: paintingUrl(3) },
  4: { key: paintingKey(4), url: paintingUrl(4) },
  5: { key: paintingKey(5), url: paintingUrl(5) },
  6: { key: paintingKey(6), url: paintingUrl(6) },
};
