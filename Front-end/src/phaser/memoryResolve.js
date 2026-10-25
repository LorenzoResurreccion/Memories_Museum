/**
 * memoryResolve.js — pure zone-ordering and memory-resolution helpers for the
 * Infinite Hallway. These functions are intentionally free of Phaser (and any
 * DOM) dependencies: they only consume plain descriptors and the static
 * Memories_Manifest, so they are trivially unit/property testable and safe to
 * import in a non-browser context.
 *
 * The only external dependency is the static manifest module (no network/fetch),
 * from which `FUTURE_MEMORY_TEXT` is imported so there is a single source of
 * truth for the future-memory copy.
 */

import { FUTURE_MEMORY_TEXT } from '../data/memories.js';

/**
 * @typedef {object} MemoryEntry
 * @property {string[]} text        dialogue pages (one string per page)
 * @property {string|null} imageUrl URL to the high-res photo, or null
 */

/**
 * @typedef {object} MemoryPayload
 * @property {string} id            stable identifier for the memory (`memory-{Memory_Index}`)
 * @property {string[]} text        0 or more dialogue pages
 * @property {string|null} imageUrl URL to the high-res photo, or null
 */

/**
 * assignZoneIndices — pure: rank 6 (or any number of) zone descriptors by
 * `(x asc, then y asc, then Tiled id asc)` and tag each with its 0-based
 * `zoneIndex`.
 *
 * The function is PURE and deterministic: it sorts a shallow COPY of the input
 * (never mutating the given array or its objects) and returns a new array of
 * the full descriptors, each extended with a `zoneIndex` equal to its rank in
 * that sorted order. For 6 distinct inputs the assigned `zoneIndex` values are
 * exactly `{0,1,2,3,4,5}` (a bijection). Repeated calls yield identical
 * assignments.
 *
 * Requirements: 12.1, 12.2
 * @template {{x:number,y:number,id:number}} T
 * @param {T[]} objects descriptors with numeric `x`, `y` and Tiled `id`
 * @returns {(T & {zoneIndex:number})[]} each input object tagged with its rank
 */
export function assignZoneIndices(objects) {
  return [...objects]
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id - b.id)
    .map((obj, zoneIndex) => ({ ...obj, zoneIndex }));
}

/**
 * resolveZonePayload — pure resolver for a single zone's memory, bounded by N.
 *
 * `memoryIndex = segIndex*6 + zoneIndex`. For `memoryIndex < authoredMemoryCount`
 * the payload mirrors the authored Memories_Manifest entry (defaulting
 * gracefully so a missing/partial entry never throws); for
 * `memoryIndex >= authoredMemoryCount` (a Future_Zone) the payload is the
 * constant future-memory overlay — one non-empty text page so it opens the
 * overlay and freezes the player exactly like an authored memory. In both cases
 * the per-zone `id` is embedded in the payload.
 *
 * Requirements: 12.3, 12.4, 12.5, 12.6, 13.5, 13.6
 * @param {number} segIndex   0-based segment index
 * @param {number} zoneIndex  0..5
 * @param {Map<number,MemoryEntry>|Record<number,MemoryEntry>} manifest the Memories_Manifest
 * @param {number} authoredMemoryCount  N — number of authored memories (manifest size)
 * @returns {{id:string, memoryIndex:number, payload:MemoryPayload}}
 */
export function resolveZonePayload(segIndex, zoneIndex, manifest, authoredMemoryCount) {
  const memoryIndex = segIndex * 6 + zoneIndex;
  const id = `memory-${memoryIndex}`;
  let payload;
  if (memoryIndex < authoredMemoryCount) {
    const entry = manifest instanceof Map ? manifest.get(memoryIndex) : manifest[memoryIndex];
    payload = { id, text: entry?.text ?? [], imageUrl: entry?.imageUrl ?? null };
  } else {
    payload = { id, text: [FUTURE_MEMORY_TEXT], imageUrl: null };
  }
  return { id, memoryIndex, payload };
}
