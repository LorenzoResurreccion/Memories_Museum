/**
 * memories.js — the Memories_Manifest for the Infinite Hallway.
 *
 * The letters themselves are NOT in this file or the bundle. They live in the
 * git-ignored `Memories/dialogue/NN.md` files and are fetched once at startup by
 * `loadMemories()` (see `loadMemories.js`), which fills `MEMORIES` via `setMemories()`
 * before the Phaser game is created. The segment-build and memory-resolution code then
 * reads `MEMORIES` synchronously, exactly as before.
 *
 * @typedef {object} MemoryEntry
 * @property {string[]} text       dialogue pages (one string per page)
 * @property {string|null} imageUrl  URL to the high-res photo, or null
 */

/**
 * MEMORIES — the Memories_Manifest.
 *
 * A plain object keyed by Memory_Index (integer), holding N entries at contiguous
 * indices `0 .. N-1`. It starts empty and is filled in place by `setMemories()`, so
 * every importer sees the loaded content through the same object. N
 * (`Object.keys(MEMORIES).length`) is the Authored_Memory_Count and drives the
 * hallway's bound: `finalSegmentIndex = N >= 1 ? Math.floor((N - 1) / 6) : 0`.
 *
 * @type {Record<number, MemoryEntry>}
 */
export const MEMORIES = {};

/**
 * Replace the manifest's contents in place with `entries`. Only contiguous integer
 * keys starting at 0 are kept, so N always equals the number of entries.
 *
 * @param {Record<number, MemoryEntry>} entries
 */
export function setMemories(entries) {
  for (const key of Object.keys(MEMORIES)) delete MEMORIES[key];
  const source = entries && typeof entries === 'object' ? entries : {};
  for (let i = 0; Object.prototype.hasOwnProperty.call(source, i); i += 1) {
    MEMORIES[i] = source[i];
  }
}

/**
 * FUTURE_MEMORY_TEXT — the single dialogue page shown for a Future_Zone
 * (a zone whose Memory_Index is `>= N`). Exact copy, verbatim (Requirement 13.5).
 * @type {string}
 */
export const FUTURE_MEMORY_TEXT = 'A future memory, not yet saved ❤';

/**
 * FUTURE_MEMORY_OVERLAY — the constant payload used when a zone resolves to a
 * future memory. It is non-empty (one text page) so it opens the overlay and
 * freezes the player exactly like an authored memory (Requirement 12.6, 13.5).
 * @type {{ text: string[], imageUrl: string|null }}
 */
export const FUTURE_MEMORY_OVERLAY = { text: [FUTURE_MEMORY_TEXT], imageUrl: null };
