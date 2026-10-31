/**
 * memories.js — the static Memories_Manifest for the Infinite Hallway.
 *
 * This is a pure, static ES module: it performs NO network access and NO fetch. The
 * dialogue `text` is bundled (it is tiny); the heavy `imageUrl` photos are NOT bundled —
 * they are referenced by URL from the `Memories/` folder via `photoUrl()` (see
 * `mediaBase.js`), served from the same location as the app. The manifest is imported
 * directly by the segment-build / memory-resolution logic and read at runtime
 * (Requirement 12.8 — static in-app content, no backend).
 *
 * @typedef {object} MemoryEntry
 * @property {string[]} text       dialogue pages (one string per page)
 * @property {string|null} imageUrl  URL to the high-res photo, or null
 */

import { photoUrl } from './mediaBase.js';

/**
 * MEMORIES — the Memories_Manifest.
 *
 * A plain object keyed by Memory_Index (integer), holding exactly N authored
 * MemoryEntry values at contiguous indices `0 .. N-1` (no gaps). The number of
 * entries, N, is the Authored_Memory_Count and drives the hallway's bound:
 * `finalSegmentIndex = N >= 1 ? Math.floor((N - 1) / 6) : 0` (Requirement 13.2). N is
 * read at runtime (`Object.keys(MEMORIES).length`), so adding or removing a memory
 * automatically resizes the hallway — keep the indices contiguous `0 .. N-1`.
 *
 * `imageUrl` is built from `photoUrl(index)` so every photo path derives from the single
 * `MEDIA_BASE_URL` (see `mediaBase.js`); the heavy photos live in `Memories/photos/`,
 * never in the bundle.
 *
 * @type {Record<number, MemoryEntry>}
 */
export const MEMORIES = {
  0: {
    text: [
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
    ],
    imageUrl: photoUrl(0),
  },
  1: {
    text: [
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
    ],
    imageUrl: photoUrl(1),
  },
  2: {
    text: [
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
    ],
    imageUrl: photoUrl(2),
  },
  3: {
    text: [
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
    ],
    imageUrl: photoUrl(3),
  },
  4: {
    text: [
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
    ],
    imageUrl: photoUrl(4),
  },
  5: {
    text: [
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
    ],
    imageUrl: photoUrl(5),
  },
  6: {
    text: [
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
      '[letter removed]',
    ],
    imageUrl: photoUrl(6),
  },
};

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
