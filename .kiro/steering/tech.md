# Tech

## Stack

### Frontend (built and shipped)
- **Phaser 4** — game engine. Tilemap rendering, arcade physics, camera, player movement, a trailing follower companion, Y-sort depth, interaction overlap zones, bounded procedural hallway segment generation, and flat wall-painting sprites hung inside each frame.
- **React 19** — UI layer rendered around and on top of the Phaser canvas. Owns the startup gate and login screen, and the dialogue box and image viewer overlays.
- **Vite 8** — dev server and bundler. React plugin uses the React Compiler (babel-plugin-react-compiler).
- **Vitest 4** + **@testing-library/react** + **jsdom** — unit and component tests.
- **fast-check 4** — property-based tests (used heavily alongside example-based tests).
- **ESLint 10** — linting, including react-hooks and react-refresh plugins.

### Asset tooling (Python)
- **Tile_Creator/tile_builder.py** — a Pillow (PIL) based CLI that compiles a JSON tile/palette config (`museum_tiles_config.json`) into a master tileset PNG under `Tile_Creator/output/`. Default sheet width is 8 columns at 16px tiles; rows are derived from tile count.

### Content (static, no API)
- The game is a static site. ALL personal content (dialogue letters, photos, painting images) lives in the git-ignored `Memories/` folder, deployed beside the app in the same S3 bucket and referenced by URL built from `MEDIA_BASE_URL` (`src/data/mediaBase.js`). None of it is in git or the JS bundle. `loadMemories()` (`src/data/loadMemories.js`) fetches `<base>/dialogue/00.md, 01.md, …` in parallel batches; N is the first missing index (non-2xx, network error, or an HTML fallback page all count as missing; it never rejects, and total failure gives N = 0). It fills the `MEMORIES` manifest in place (`setMemories`) and rebuilds `PAINTINGS` from it (`syncPaintings`); the game then reads both synchronously. `StartupGate` calls it (see "Startup and sign-in"), never `main.jsx`. Never put letter text back into the code, tests, or docs; tests seed stand-in entries with `setMemories()`.

### Backend: one small login function (`Auth-function/`)
- **The only server-side piece**, deliberately scoped: an AWS Lambda (Node ESM, function URL) behind the same CloudFront domain at `/api/*`. It checks the sign-in and issues the three CloudFront signed cookies that unlock `/Memories/*`. Do not add any other backend/API without an explicit decision. Design: `.kiro/specs/museum-login/` and `docs/Private_Media_Deployment.md`.
- **Routes:** `POST /api/login/start` (`{username, password}` → `200 {questions:[3]}`) and `POST /api/login/finish` (`{username, password, answers[3]}` → `204` + 3 `Set-Cookie`). Order per request: validate body (400, not counted) → per-IP attempt limit (429 + `Retry-After`) → config (503) → every check → 401 (counted) or success. Every response is `Cache-Control: no-store`.
- **Pure, testable modules:** `normalize.js` (answers ignore case/spacing/punctuation; usernames trim + lowercase; passwords exact), `hashing.js` (salted scrypt `scrypt$N$r$p$salt$key`, constant-time compare; N = 2^15, about 2 s per sign-in, accepted), `checks.js` (always runs all 5 comparisons), `cookies.js` (12-hour custom policy for `https://<APP_DOMAIN>/Memories/*`; `Path=/Memories; Secure; HttpOnly; SameSite=Strict`, no `Domain`, no `Expires`: a session cookie), `limiter.js` (5 failures / 15 min per hashed IP, in memory, on a single instance via reserved concurrency 1; may reset when idle, accepted; no site-wide limit), `config.js` (validates env vars once per instance).
- **Secrets** are Lambda environment variables set by hand in the console: `AUTH_CONFIG` (hashed username, password and answers + the 3 prompts) and `CLOUDFRONT_PRIVATE_KEY_B64`, plus non-secret `CLOUDFRONT_KEY_PAIR_ID` and `APP_DOMAIN`. Never put them in git, the bundle, any `VITE_*` variable (those are public), CI secrets, or logs. Logs carry only route, outcome and timing. `tools/make-config.mjs` generates them (hidden input; `--demo` writes the git-ignored `Auth-function/demo/auth-config.local.json` instead; `--key` prints the key value and checks Lambda's 4 KB limit).
- **Build:** `npm run build` bundles `src/handler.js` and its deps (including `@aws-sdk/cloudfront-signer`) into one file, `dist/handler.mjs`, which runs standalone (Lambda handler `handler.handler`).

### Hosting (target)
- **Amazon S3 + CloudFront.** Private bucket behind OAC; behaviors `/Memories/*` (GET/HEAD, signed cookies required), `/api/*` (the Lambda, caching off) and the default (the app, unrestricted). The `Memories/` folder is uploaded as-is beside the built app; editing or adding a letter is an upload, not a rebuild. Deploy (and any GitHub Actions pipeline) is spec task 13.

## Startup and sign-in

`main.jsx` renders `<StartupGate><App /></StartupGate>` immediately. `StartupGate` owns the order and renders `App` (and so the Phaser game) only in `ready`; `App.jsx` stays the overlay coordinator.

- **Auth on** (`VITE_AUTH_ENABLED=true`: production builds via `.env.production`, and `npm run dev:auth` via `.env.demo`): `checking` (send `HEAD <base>/dialogue/00.md`) → `login` (`LoginScreen`) or straight to `loading` → `ready`.
- **Auth off** (`npm run dev`): `loading` → `ready`, exactly as before the login existed.
- **403 means "not signed in", and only that.** The session probe reads 200/404 as signed in, 403 as signed out, anything else as unreachable (login + "Try again"). Keep it true: never configure a CloudFront custom error response for 403/404 (they are distribution-wide and would turn these into HTML), and give the distribution `s3:ListBucket` so a missing letter is 404.
- **`LoginScreen`** (`src/components/LoginScreen.jsx`, styles in `LoginScreen.css`, wording in `loginMessages.js`): username + password, then the three questions one at a time (Back, "1 of 3"); nothing is sent until the last answer, then all go in one request, so a failure never says which answer was wrong. No reset, sign-up, remember-me or sign-out. `src/data/authClient.js` makes the calls and adds `x-amz-content-sha256` (hex SHA-256 of the exact body), which Lambda behind CloudFront + OAC requires on POST.
- **Demo_Mode** (`npm run dev:auth` = `vite --mode demo`): `Front-end/dev/authDemoPlugin.js`, a dev-server-only Vite plugin (`apply: 'serve'`, added only in demo mode), runs the real `Auth-function` handler for `/api/*` (after the same body-hash check) and stands in for CloudFront on `/Memories/*`, verifying the signed cookies against a demo key generated at startup (in memory). Never part of `npm run build`. Chrome or Firefox only (Safari rejects `Secure` cookies on `http://localhost`).

## Architecture: the Phaser–React bridge

The game and UI are decoupled and communicate through a single pub/sub singleton, `src/phaser/EventBus.js` (`on` / `off` / `emit`, ordered delivery, events with no subscribers are silently dropped).

Flow:
1. In the Phaser scene, `InteractionManager.checkInteraction()` detects player overlap of a zone + the interaction key `E` (edge-detected so a held key fires once; Space/Enter/Esc are never open keys) and emits `hotspot-activated` with `{ id, text, imageUrl }` resolved from the `MEMORIES` manifest.
2. `GameScene` listens for `hotspot-activated` and freezes the player + locks the `InteractionManager`.
3. React `App.jsx` also listens for `hotspot-activated`, guards against double activation with a ref, and opens the dialogue and/or image overlay.
4. On dismiss, React emits `dialogue-dismissed` / `image-dismissed`; `GameScene` unfreezes the player and unlocks interaction.

When adding cross-boundary behavior, extend this event pattern rather than reaching into Phaser objects from React (or vice versa).

**Overlay coexistence (App.jsx).** When a memory has both text and a photo, both overlays show at once and the photo stays up the whole time the player pages through the dialogue. While the dialogue is open it owns the keyboard (`Space` pages; final `Space`/`Esc` dismisses), and dismissing the dialogue also closes the photo — `ImageViewer` only self-handles keys when it is shown alone (`keyboardActive`). The photo is sized to roughly the map height, is framed with the hallway's frame-tile palette (dark brown / gold / tan bands, hard-edged), and does not dim the dialogue box (no scrim), so the letter stays readable beneath it. If a photo fails to load (typically the 12-hour access window ended), it says to refresh.

**One visual language.** The login panel, dialogue box and photo viewer share the frame-tile palette: dark brown `#7a5a2c`, gold `#d4af37`, tan `#a8864c`, deep brown fill `#2b1d0e`, cream text `#f4ead5`, hard edges, no rounded corners. The dialogue box has a fixed size (from just below the game window's frame to the bottom of the screen) whatever the text length; long pages scroll inside it, and the ▼ "more pages" arrow sits in its bottom-right corner, outside the text flow. All text names `"Press Start 2P"`, but that font is not loaded anywhere yet, so it falls back to Courier New.

## Key engine conventions

- **Tile grid is 16px.** Player sprite frames are 32×32 (`Lorenzo_Sprite.png`, 4 columns × 4 rows; rows = Down/Left/Right/Up, columns = neutral/step/neutral/step). The physics body stays 16×16 at the feet (offset `(8, 16)`). Walk speed is `PLAYER_SPEED_PX_PER_SEC` (80) in `GameScene.js`, paired with the walk-cycle rate `_animFrameRate` (4) in `PlayerController`; tune them together. Maps are 58×15 tiles (928×240 px).
- **Feet origin for sorting.** The player and every sortable decor sprite use origin `(0.5, 1)`; world Y is the depth sort key, re-sorted every frame in `update()`.
- **Layers:** `Tile Layer 1` (floor + back wall, fixed low depth `FLOOR_DEPTH` = 0, drawn beneath everything) → wall paintings (flat art at `WALL_DEPTH` = 1, above the floor and strictly below every Y-sort member) → `Tile Layer 2` (decor, exploded into per-tile Y-sortable sprites) → optional `foreground`/overhead (fixed high depth `10000`). There is **no collision tile layer**: collision is derived by `CollisionBuilder` from per-tile collision shapes (`objectgroup`) embedded in the tilesets, built as static bodies for both tile layers. Paintings use `add.image` (no physics body) so they never block movement.
- **Maps come from Tiled** as JSON (`museum_start` = fixed left end, `museum_hallway` = the repeating segment template). `Object Layer 1` is read **type-aware**: objects are partitioned by Tiled class (`type ?? class`) into `memory_zone` (interaction zones) and `painting` (wall art); any other/untyped object is ignored. The player start is a `player_spawn` object in the spawn object layer, with an in-bounds floor fallback.
- **Interaction zones** are authored as sized Tiled rectangles; `_buildSegment` passes each object's `width`/`height` to the zone, falling back to `ZONE_WIDTH_PX`/`ZONE_HEIGHT_PX` (48px) for a sizeless object. **Paintings** are authored as sized rectangles too; the sprite is stretched (`setDisplaySize`) to fully cover the object's bounds, so size each one to its frame's inner area.
- **Graceful asset failures.** The scene tracks load errors and renders a readable error message instead of crashing. Preserve this when touching `preload()`/`create()`.
- **Canvas & camera.** Canvas is 1120×480; camera uses integer zoom (2×) and follows the player. The canvas height is the map height (240px) × zoom (2) so the viewport's world height matches the map exactly — this avoids a black band below the floor. Scale mode is `NONE` with `CENTER_BOTH` auto-centering. The camera's left bound is pinned at the start-map left edge; the right bound grows as segments generate and is capped at the final segment's right edge.
- **Page layout around the canvas (`App.css`).** The app fills the browser window (solid `#160e07`). The centered canvas sits in a wooden frame: a 9-slice `border-image` of `public/border.jpg` (1584×672, sliced 147 image px in, past the gold corner flourishes, so corners never stretch) drawn behind the canvas on `.app-container::before`; `fill` shows its dark center on the login and loading screens. Layout reads CSS variables on `.app-container`: `--game-half-width` / `--game-half-height` (560px / 240px; keep in sync with `config.js`), and `--frame-scale` (frame size relative to the image), from which `--frame-side/top/bottom` follow. The dialogue box positions itself from `--game-half-height` + `--frame-bottom`.

## Infinite hallway

The gallery is a bounded, procedurally-stitched hallway rather than a single fixed map:
- **`SegmentManager`** generates, positions, counts, and recycles hallway segments as the player moves, bounded on the right at `Final_Segment_Index = N >= 1 ? floor((N-1)/6) : 0` where `N` is the number of authored memories. Max 3 segments are instantiated at once. Pure index/offset arithmetic is testable without a live scene; scene-touching work is injected via `buildSegment`/`releaseSegment` closures in `GameScene`.
- **`memoryResolve.js`** (`assignZoneIndices`, `resolveZonePayload`) orders a segment's zones deterministically and maps each to a `MEMORIES` entry, or to the "future memory" placeholder (`FUTURE_MEMORY_OVERLAY`) when the zone index is `>= N`.
- **`paintingResolve.js`** (`partitionObjectsByType`, `assignPaintingIndices`, `resolvePaintingImage`) splits `Object Layer 1` by type, ranks paintings by the same `(x, y, id)` rule as zones so painting rank `k` aligns with memory-zone rank `k`, and resolves each to a `PAINTINGS` texture key (or the placeholder for future/missing art). Pure, no Phaser — testable without a live scene.
- **`InteractionManager`** owns the `E` key edge detection, registers/releases each segment's zones, reports overlap (drives `PromptLabel`), and emits `hotspot-activated`. Paintings emit no events.
- **`PromptLabel`** is the floating `[E]` prompt pinned above the player, shown iff the player overlaps a zone and no overlay is open.

## Follower companion (Kelly)

- **`FollowerController`** drives Kelly (`Kelly_Sprite.png`, same 32×32 4×4 layout as the player), a purely visual companion: `add.sprite` with no physics body, no colliders, never passed to `InteractionManager`, and it emits no events. It subscribes to `hotspot-activated` (freeze) and `dialogue-dismissed` / `image-dismissed` (unfreeze), and `destroy()` on scene shutdown removes exactly those handlers.
- **Following mode** replays the path the player actually walked (`followerTrail.js`, pure, no Phaser) at `FOLLOW_DISTANCE_PX` (24) behind, capped at the player's speed; a player jump > 64 px resets the trail. **Settling mode**: when the player stops with Kelly closer than 16 px, she walks once to a rest spot (behind, front, above, below) chosen by `followerCollision.js` (pure) against a one-time snapshot of the static collision boxes; if none is valid she holds still until the player moves.
- Kelly's sprite position is always whole-pixel, clamped to the player's hallway bounds, and her depth is set after the Y-sort pass via `resolveFollowerDepth` (stable tie with the player). A missing `follower` texture is non-fatal: the scene runs without her.

## Commands

Run frontend commands from `Front-end/`:

```bash
npm install        # install dependencies
npm run dev        # Vite dev server, no login (run manually in your terminal)
npm run dev:auth   # Vite dev server with the local login (Demo_Mode; run manually)
npm run build      # production build (login on)
npm run preview    # preview the production build
npm run test       # vitest --run (single pass, no watch)
npm run lint       # eslint
```

Login function, from `Auth-function/`:

```bash
npm install                          # its own dependencies (also needed for npm run dev:auth)
npm run test                         # vitest --run
npm run lint                         # eslint
npm run build                        # dist/handler.mjs for Lambda
node tools/make-config.mjs --demo    # set the local demo login (the user runs this: hidden input)
node tools/make-config.mjs --key k.pem   # deploy day: print the Lambda env var values
```

Asset tooling, from `Tile_Creator/`:

```bash
python tile_builder.py   # compile the tileset PNG from the JSON config
```

## Conventions and guardrails

- Prefer `npm run test` (single run) over watch mode. Do not start long-running dev servers or watchers on the user's behalf (`npm run dev`, `npm run dev:auth`) — hand the user the command to run. Never run `make-config.mjs` for the user: it takes secrets.
- Heavy property tests (hundreds of hashes or simulation runs) can pass alone but exceed Vitest's 5 s default under the full suite's load; give them an explicit timeout (e.g. `30_000`) rather than cutting `numRuns`.
- Keep `Auth-function/` free of `Front-end/` imports. The only link is the other way and dev-only: the Demo_Mode plugin imports the handler.
- Match existing style: ES modules, functional React components with hooks, class-based Phaser scene/manager modules with JSDoc.
- When adding features or fixing bugs, add both example-based and property-based (fast-check) tests to match the existing test suite's style, and run the suite before declaring done.
- Keep heavy media out of the game bundle; reference it by URL. Keep personal content (letters, photos, paintings) out of git entirely — it belongs in `Memories/`. Keep secrets (password, answers, private key, even hashed) out of git and every `VITE_*` value.
