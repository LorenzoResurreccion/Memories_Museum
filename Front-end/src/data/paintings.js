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
import { MEMORIES } from './memories.js';

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
 * DERIVED from `MEMORIES`: one entry per loaded memory, rebuilt in place by
 * `syncPaintings()` after `loadMemories()` runs (no second list to edit). Each entry's `key` is
 * the texture key the scene renders and its `url` is where that texture loads from
 * (`<base>/paintings/NN.png`). If `NN.png` is missing from the media folder or bucket,
 * the load fails locally and the frame shows the placeholder (never fatal).
 *
 * @type {Record<number, PaintingEntry>}
 */
export const PAINTINGS = {};

/**
 * Rebuild `PAINTINGS` in place from the current `MEMORIES` (one entry per memory).
 * Called by `loadMemories()` after the letters are installed; safe to call any time.
 */
export function syncPaintings() {
  for (const key of Object.keys(PAINTINGS)) delete PAINTINGS[key];
  for (const i of Object.keys(MEMORIES).map(Number).sort((a, b) => a - b)) {
    PAINTINGS[i] = { key: paintingKey(i), url: paintingUrl(i) };
  }
}

syncPaintings();
