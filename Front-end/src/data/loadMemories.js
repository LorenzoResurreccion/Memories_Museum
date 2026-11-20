/**
 * loadMemories.js — fetches the private dialogue letters at startup and fills the
 * MEMORIES manifest (and the PAINTINGS derived from it) before the game boots.
 *
 * The letters live in the git-ignored `Memories/dialogue/NN.md` files, served from the
 * same place as the photos and paintings (`MEDIA_BASE_URL`). Nothing personal is in the
 * code or the bundle. N is discovered from the files: indices are probed `00, 01, …`
 * in parallel batches and N is the first index whose letter is missing.
 *
 * A "missing" letter is any of: a network error, a non-2xx response (S3 answers 403,
 * not 404, when bucket listing is off), or an HTML response (an SPA fallback page from
 * the Vite dev server or a CloudFront 404 rewrite). Loading never throws; a total
 * failure just yields N = 0 (a hallway of future memories).
 */

import { dialogueUrl, photoUrl } from './mediaBase.js';
import { setMemories } from './memories.js';
import { syncPaintings } from './paintings.js';

/** Letters fetched in parallel per batch. */
export const LOAD_BATCH_SIZE = 8;

/** Hard cap on probed indices, so a misconfigured server can never loop forever. */
export const MAX_MEMORY_COUNT = 500;

/**
 * Split a letter into dialogue pages. Pages are separated by a line containing only
 * `---` (surrounding spaces allowed). Each page is trimmed; empty pages are dropped.
 * Handles CRLF line endings and a leading BOM. Pure.
 *
 * @param {string} markdown
 * @returns {string[]}
 */
export function parseDialogue(markdown) {
  if (typeof markdown !== 'string') return [];
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return normalized
    .split(/^[ \t]*---[ \t]*$/m)
    .map((page) => page.trim())
    .filter((page) => page.length > 0);
}

/**
 * True when a response body looks like an HTML page rather than a letter.
 * @param {string} body
 */
function looksLikeHtml(body) {
  return /^\s*<(!doctype\s+html|html)[\s>]/i.test(body);
}

/**
 * Fetch one letter. Resolves to its markdown text, or `null` when it is missing.
 * Never rejects.
 *
 * @param {number} index
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string|null>}
 */
export async function fetchDialogue(index, fetchImpl) {
  try {
    const res = await fetchImpl(dialogueUrl(index), { cache: 'no-cache' });
    if (!res || !res.ok) return null;
    const type = (res.headers && typeof res.headers.get === 'function'
      ? res.headers.get('content-type')
      : '') || '';
    if (type.toLowerCase().includes('text/html')) return null;
    const body = await res.text();
    if (typeof body !== 'string' || looksLikeHtml(body)) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * Probe `00.md, 01.md, …` and build the MEMORIES-shaped entries for the contiguous
 * run starting at 0. Letters after the first gap are ignored (indices stay 0..N-1).
 * Does not touch the shared manifest; see {@link loadMemories}.
 *
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl=globalThis.fetch]
 * @param {number} [options.batchSize=LOAD_BATCH_SIZE]
 * @param {number} [options.maxCount=MAX_MEMORY_COUNT]
 * @returns {Promise<Record<number, {text: string[], imageUrl: string|null}>>}
 */
export async function fetchMemoryEntries({
  fetchImpl = globalThis.fetch,
  batchSize = LOAD_BATCH_SIZE,
  maxCount = MAX_MEMORY_COUNT,
} = {}) {
  /** @type {Record<number, {text: string[], imageUrl: string|null}>} */
  const entries = {};
  if (typeof fetchImpl !== 'function') return entries;
  const size = Math.max(1, Math.floor(batchSize) || 1);

  for (let start = 0; start < maxCount; start += size) {
    const indices = [];
    for (let i = start; i < Math.min(start + size, maxCount); i += 1) indices.push(i);
    const bodies = await Promise.all(indices.map((i) => fetchDialogue(i, fetchImpl)));

    for (let k = 0; k < indices.length; k += 1) {
      if (bodies[k] === null) return entries;
      const i = indices[k];
      entries[i] = { text: parseDialogue(bodies[k]), imageUrl: photoUrl(i) };
    }
  }
  return entries;
}

/**
 * Load the letters and install them as the shared MEMORIES manifest, then rebuild
 * PAINTINGS to match. Call once before the Phaser game is created. Never rejects.
 *
 * @param {Parameters<typeof fetchMemoryEntries>[0]} [options]
 * @returns {Promise<number>} N, the number of memories loaded
 */
export async function loadMemories(options) {
  const entries = await fetchMemoryEntries(options);
  setMemories(entries);
  syncPaintings();
  return Object.keys(entries).length;
}
