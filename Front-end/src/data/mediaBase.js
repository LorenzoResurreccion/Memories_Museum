/**
 * mediaBase.js — single source of truth for where the museum's heavy media lives.
 *
 * The real photos and pixel paintings are NOT bundled with the app; they live in the
 * `Memories/` folder, which is deployed alongside the built app in the same S3 bucket.
 * Every media URL in `memories.js` / `paintings.js` (and the painting texture loads in
 * `GameScene.preload()`) is built from `MEDIA_BASE_URL` + a relative path, so swapping
 * environments is a ONE-LINE change here — no per-entry edits.
 *
 * Layout under the base (see `Memories/README.md`):
 *   <base>/photos/NN.jpg     full-res photos shown in the ImageViewer overlay
 *   <base>/paintings/NN.png  pixel art hung inside each frame (loaded as a Phaser texture)
 *
 * ## Dev vs deploy
 *
 * - **Deployed (S3):** the whole project tree is uploaded, so the built app and the
 *   `Memories/` folder keep their relative positions in the bucket. Point `MEDIA_BASE_URL`
 *   at the deployed `Memories/` location (e.g. `'/Memories'` if `Memories/` sits at the
 *   bucket root next to the app, or the full CloudFront URL).
 * - **Local (`npm run dev`):** Vite only serves files under `Front-end/public/`, so it
 *   cannot reach `../Memories/` over HTTP. To preview real media locally, either set
 *   `VITE_MEDIA_BASE_URL` to a URL your dev environment can serve the `Memories/` folder
 *   from, or symlink `Memories/` into `Front-end/public/` and point the base there.
 *
 * Reads `import.meta.env.VITE_MEDIA_BASE_URL` when provided (set it in a `.env` for dev),
 * else falls back to the deploy-time default below.
 */

/** @type {string} */
export const MEDIA_BASE_URL =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_MEDIA_BASE_URL) ||
  '/Memories';

/**
 * Build the URL for a painting texture by Memory_Index (zero-padded: `00.png`).
 * @param {number} index
 * @returns {string}
 */
export function paintingUrl(index) {
  return `${MEDIA_BASE_URL}/paintings/${String(index).padStart(2, '0')}.png`;
}

/**
 * Build the URL for a full-res photo by Memory_Index (zero-padded: `00.jpg`).
 * @param {number} index
 * @returns {string}
 */
export function photoUrl(index) {
  return `${MEDIA_BASE_URL}/photos/${String(index).padStart(2, '0')}.jpg`;
}
