/**
 * memories.js — the static Memories_Manifest for the Infinite Hallway.
 *
 * This is a pure, static ES module: it performs NO network access and NO fetch.
 * The manifest is imported directly by the segment-build / memory-resolution
 * logic and read at runtime (Requirement 12.8 — static in-app content, no
 * backend).
 *
 * @typedef {object} MemoryEntry
 * @property {string[]} text       dialogue pages (one string per page)
 * @property {string|null} imageUrl  URL to the high-res photo, or null
 */

/**
 * MEMORIES — the Memories_Manifest.
 *
 * A plain object keyed by Memory_Index (integer), holding exactly N authored
 * MemoryEntry values at contiguous indices `0 .. N-1` (no gaps). The number of
 * entries, N, is the Authored_Memory_Count and drives the hallway's bound:
 * `finalSegmentIndex = N >= 1 ? Math.floor((N - 1) / 6) : 0` (Requirement 13.2).
 *
 * NOTE: These are PLACEHOLDER entries. This is a personal gift project, so the
 * real sentimental letters and photos are intentionally NOT authored here — do
 * not invent intimate copy. Replace these generic placeholders with the real
 * authored `text` pages and `imageUrl` values when the content is ready. Heavy
 * media (photos) is referenced by URL later (staged in the git-ignored
 * `Memories/` folder), which is why `imageUrl` is `null` for every placeholder.
 *
 * Keep indices contiguous `0 .. N-1`: adding or removing an entry changes N and
 * therefore the number of authored zones and `finalSegmentIndex`.
 *
 * @type {Record<number, MemoryEntry>}
 */
export const MEMORIES = {
  0: {
    text: ['Memory 0 — placeholder page 1.', 'Memory 0 — placeholder page 2.'],
    imageUrl: null,
  },
  1: {
    text: ['Memory 1 — placeholder page 1.', 'Memory 1 — placeholder page 2.'],
    imageUrl: null,
  },
  2: {
    text: ['Memory 2 — placeholder page 1.', 'Memory 2 — placeholder page 2.'],
    imageUrl: null,
  },
  3: {
    text: ['Memory 3 — placeholder page 1.', 'Memory 3 — placeholder page 2.'],
    imageUrl: null,
  },
  4: {
    text: ['Memory 4 — placeholder page 1.', 'Memory 4 — placeholder page 2.'],
    imageUrl: null,
  },
  5: {
    text: ['Memory 5 — placeholder page 1.', 'Memory 5 — placeholder page 2.'],
    imageUrl: null,
  },
  6: {
    text: ['Memory 6 — placeholder page 1.', 'Memory 6 — placeholder page 2.'],
    imageUrl: null,
  },
  7: {
    text: ['Memory 7 — placeholder page 1.', 'Memory 7 — placeholder page 2.'],
    imageUrl: null,
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
