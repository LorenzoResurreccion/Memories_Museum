/**
 * paintingResolve.js — pure painting-ordering, image-resolution, and object
 * type-partition helpers for the Wall Paintings feature.
 *
 * Mirroring `memoryResolve.js`, these functions are intentionally free of Phaser
 * (and any DOM) dependencies: they consume plain descriptors and the static
 * Painting_Image_Source, so they are trivially unit/property testable and safe to
 * import in a non-browser context. The only external dependency is the static
 * `paintings.js` module (no network/fetch), the single source of truth for the
 * placeholder texture key.
 */

import { PAINTING_PLACEHOLDER_KEY } from '../data/paintings.js';

/**
 * assignPaintingIndices — pure: rank painting descriptors by
 * `(x asc, then y asc, then Tiled id asc)` and tag each with its 0-based
 * `paintingIndex`.
 *
 * This is the IDENTICAL ordering rule used by `assignZoneIndices` in
 * `memoryResolve.js`, so painting rank `k` aligns with memory-zone rank `k` and a
 * painting's Memory_Index therefore matches its co-located memory zone's (Req 3.2).
 * The function is PURE and deterministic: it sorts a shallow COPY of the input
 * (never mutating the given array or its objects) and returns a new array of the
 * full descriptors, each extended with a `paintingIndex` equal to its rank.
 *
 * Requirements: 3.1, 3.2
 * @template {{x:number,y:number,id:number}} T
 * @param {T[]} objects descriptors with numeric `x`, `y` and Tiled `id`
 * @returns {(T & {paintingIndex:number})[]} each input object tagged with its rank
 */
export function assignPaintingIndices(objects) {
  return [...objects]
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id - b.id)
    .map((obj, paintingIndex) => ({ ...obj, paintingIndex }));
}

/**
 * resolvePaintingImage — pure resolver for a single painting's texture key, bounded
 * by N.
 *
 * `memoryIndex = segIndex*6 + paintingIndex`. For `memoryIndex < authoredMemoryCount`
 * the key is that Memory_Index's `PAINTINGS` entry `key`, falling back gracefully to
 * `PAINTING_PLACEHOLDER_KEY` when the entry or its `key` is missing. For
 * `memoryIndex >= authoredMemoryCount` (a Future_Painting) the key is always
 * `PAINTING_PLACEHOLDER_KEY`. `isPlaceholder` is true iff the resolved key is the
 * placeholder. The function is deterministic: the same arguments always yield the
 * same key (Req 3.4).
 *
 * Requirements: 3.2, 3.3, 3.5, 5.2
 * @param {number} segIndex   0-based segment index
 * @param {number} paintingIndex  0..5
 * @param {Record<number,{key:string}>} source  the PAINTINGS Painting_Image_Source
 * @param {number} authoredMemoryCount  N — number of authored memories (manifest size)
 * @returns {{memoryIndex:number, key:string, isPlaceholder:boolean}}
 */
export function resolvePaintingImage(segIndex, paintingIndex, source, authoredMemoryCount) {
  const memoryIndex = segIndex * 6 + paintingIndex;
  if (memoryIndex < authoredMemoryCount) {
    const entry = source instanceof Map ? source.get(memoryIndex) : source?.[memoryIndex];
    const key = entry && entry.key ? entry.key : PAINTING_PLACEHOLDER_KEY;
    return { memoryIndex, key, isPlaceholder: key === PAINTING_PLACEHOLDER_KEY };
  }
  return { memoryIndex, key: PAINTING_PLACEHOLDER_KEY, isPlaceholder: true };
}

/**
 * partitionObjectsByType — pure: split an `Object Layer 1` object array into the
 * memory-zone and painting subsets by Tiled class.
 *
 * Each object's class is read as `obj.type ?? obj.class ?? ''` (robust across Tiled
 * versions: older Tiled writes `type`, Tiled >= 1.9 writes `class`). Only objects
 * whose class is exactly `'memory_zone'` go into `memoryZones`; only `'painting'`
 * objects go into `paintings`. Every other, empty, or missing type is excluded from
 * BOTH subsets, so adding painting objects can never be mis-counted as memory zones
 * (and vice versa). The function is PURE: it preserves the input order within each
 * subset and never mutates the input array or its objects.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1
 * @template {{type?:string, class?:string}} T
 * @param {T[]} objects raw objects read from `Object Layer 1`
 * @returns {{memoryZones: T[], paintings: T[]}}
 */
export function partitionObjectsByType(objects) {
  const list = Array.isArray(objects) ? objects : [];
  const typeOf = (o) => (o && (o.type ?? o.class ?? '')) || '';
  const memoryZones = [];
  const paintings = [];
  for (const obj of list) {
    const t = typeOf(obj);
    if (t === 'memory_zone') memoryZones.push(obj);
    else if (t === 'painting') paintings.push(obj);
  }
  return { memoryZones, paintings };
}
