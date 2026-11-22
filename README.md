# 🏛️ The Living Museum: An Anniversary Journey

A bespoke, interactive 2.5D retro side-scrolling video game built as a personalized anniversary gift. The player explores a warm-cream minimalist art gallery, controlling a custom 16-bit character sprite across a hardwood floor depth plane. Walking up to a framed pixel canvas and pressing an interaction key triggers a React UI overlay that shows a high-resolution couple photo and streams sentimental dialogue letters.

The game is a static site. The personal content (letters, photos, paintings) is kept out of the repo in a private `Memories/` folder that is uploaded beside the app and fetched by URL, and it is locked behind a sign-in: one small AWS Lambda function checks it and issues the CloudFront signed cookies that unlock `/Memories/*`.

---

## 🎨 Core Gameplay Features

*   **Museum Sign-in:** A username and password, then three questions about the relationship, one at a time. Answers forgive case, spacing and punctuation. One sign-in per browser session; closing the browser signs out. The sign-in is checked on the server, so the files themselves are locked, not just hidden.
*   **Framed Game Window:** The game sits in a dark wooden frame with gold corner flourishes. The login panel, dialogue box and photo viewer share its brown-and-gold palette, and the dialogue box keeps a steady size beneath the frame.
*   **2.5D Walkable Gallery Depth:** Vertical Y-sorting within a side-scrolling layout. The player moves left/right and up/down across the floor, dynamically sorting behind or in front of benches, props, and decor.
*   **Bounded Infinite Hallway:** The gallery is procedurally stitched from repeating segments as the player walks, bounded on the right by the number of authored memories. Segments generate and recycle on the fly to keep the runtime light.
*   **Follower Companion:** Kelly walks a few steps behind along the exact path the player took, steps aside to stand beside the player when they stop, and pauses while a memory is open. She is purely visual: no collision, no interaction.
*   **Interaction Zones:** Invisible zones span the full width of each framed canvas. Standing in front of one shows a floating `[E]` prompt; pressing `E` opens its dialogue and/or photo.
*   **Wall Paintings:** Every framed canvas displays a pixel-art painting for its memory, so each memory shows up both as a floor interaction zone and as art hanging in its frame. Paintings are purely visual — no interaction, no collision — and fall back to a placeholder until real art is authored.
*   **Phaser-to-React State Bridge:** A lightweight decoupled runtime. Player interaction inside the WebGL game canvas dispatches custom events through a shared EventBus to trigger smooth HTML/React UI overlays.
*   **Light Runtime Footprint:** Pixel assets ship with the game; the letters, photos and paintings are fetched by URL from the private `Memories/` folder rather than bundled.

---

## 🛠️ Key Technologies

### Game Engine
*   **Phaser 4:** Drives the 2D rendering pipeline, 4-direction character physics, per-tile static collision, camera, bounded procedural segment generation, and interaction zones.

### UI Layer
*   **React 19:** Renders layout components layered around and on top of the game canvas for accessible text delivery and photo rendering.

### Build & Tooling
*   **Vite 8:** Dev server and bundler (with the React Compiler).
*   **Vitest 4 + Testing Library + fast-check:** Example-based and property-based tests.
*   **Tile_Creator (Python / Pillow):** A CLI that compiles a JSON palette + tile layout into a 16px master tileset PNG.

### Login function
*   **AWS Lambda (Node, `Auth-function/`):** Checks the sign-in (salted scrypt hashes, per-connection attempt limit) and issues CloudFront signed cookies. Secrets are Lambda environment variables, never in git or the bundle. Bundled with esbuild into one file.

### Hosting (target)
*   **Amazon S3 + CloudFront:** A private bucket behind CloudFront. The app is served freely; `/Memories/*` requires the signed cookies; `/api/*` reaches the login function. See `docs/Private_Media_Deployment.md`.

---

## 🧩 Memory Content Model

All personal content lives in the git-ignored `Memories/` folder, named by contiguous index `0 .. N-1`. None of it is in this repo or the JS bundle:

| File               | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `dialogue/NN.md`   | The letter; pages are separated by a line containing only `---`    |
| `photos/NN.jpg`    | The high-res photo                                                 |
| `paintings/NN.png` | Pixel art for that memory's frame (placeholder if missing)         |

At startup, `Front-end/src/data/loadMemories.js` fetches `dialogue/00.md, 01.md, …` and stops at the first missing number, which sets `N`. It fills the `MEMORIES` manifest (`memories.js`) and derives the `PAINTINGS` list (`paintings.js`) from it before the game starts. Every path is built from a single `MEDIA_BASE_URL` (`Front-end/src/data/mediaBase.js`), so pointing the app at a new location (local dev vs. the deployed S3 bucket) is a one-line change.

**Adding a memory** is just dropping `NN.md` (plus its photo and painting) into `Memories/` and uploading — no code edit, no rebuild. The hallway resizes itself to `N`.

The gallery is a bounded "infinite hallway": the authored count `N` sets how far it extends (`finalSegmentIndex = N ≥ 1 ? floor((N-1)/6) : 0`). The Tiled maps hold only object *positions/sizes* on a type-aware `Object Layer 1` — `memory_zone` objects become interaction zones (resolved at runtime to a manifest entry, or a single "future memory" placeholder page past the authored memories) and `painting` objects become the wall art; zone indexing ignores paintings, so adding art never shifts a memory. The player start is a `player_spawn` object in the spawn object layer, with an in-bounds floor fallback.

### Overlays: reading a memory

Activating a hotspot opens the memory's photo (centered, sized to roughly the map's height so the dialogue stays readable beneath it) and pages of dialogue. The photo stays on screen the whole time you page through the letter with `Space`; the final `Space` (or `Esc`) closes both together. The photo does not dim the dialogue box.

---

## 📂 Project Structure

```text
Memories_Museum/
├── Front-end/                 # React + Phaser app (Vite), built and hosted statically
│   ├── public/
│   │   ├── border.jpg         # Wooden frame around the game window
│   │   ├── pixel_icon.png     # Favicon
│   │   └── assets/            # Pixel assets only (tiny footprint)
│   │       ├── maps/          # Exported Tiled .json maps
│   │       ├── tilesets/      # 16-bit environment tiles (.png)
│   │       ├── sprites/       # 4-way character walking sheets (32×32 frames, 4×4): player + follower
│   │       └── photos/        # bundled placeholder painting texture
│   ├── dev/                   # Dev-server-only: the local login stand-in for npm run dev:auth
│   └── src/
│       ├── components/        # StartupGate, LoginScreen, GameCanvas, DialogueBox, ImageViewer
│       ├── data/             # authClient.js (login calls), loadMemories.js (startup fetch), memories.js, paintings.js, mediaBase.js
│       ├── phaser/            # Phaser scene, player + follower controllers, segment/interaction subsystems, EventBus bridge
│       └── App.jsx            # Coordinates React and Phaser state
│
├── Auth-function/             # Museum login (AWS Lambda): checks the sign-in, issues CloudFront
│                              # signed cookies for /Memories/*. Own package.json. Spec: .kiro/specs/museum-login
│
├── Memories/                  # Private content (git-ignored): dialogue letters, real photos, pixel paintings
│                              # Uploaded to S3 beside the app; symlinked into Front-end/public/ for local dev
└── Tile_Creator/              # Python tool that compiles tileset PNGs from a JSON config
```

---

## 🚀 Local Development Setup

### Frontend
1. Navigate to the client directory: `cd Front-end`
2. Install npm packages: `npm install`
3. Start the hot-reloading dev server: `npm run dev`

### Previewing the private media locally
`MEDIA_BASE_URL` defaults to `/Memories`, but Vite only serves files under `Front-end/public/`. To load the real letters, photos and paintings during `npm run dev`, create a local, git-ignored symlink from `public/` to the `Memories/` folder (one time, from the repo root):

```bash
ln -s ../../Memories Front-end/public/Memories
```

Without it no letters load, so `N` is 0 and every frame shows the "future memory" page (a console warning says so). The symlink is a local convenience only: it is not committed, and on S3 the real `Memories/` folder is uploaded beside the app. Note that `npm run build` copies the symlinked folder into `dist/Memories/`, so upload either `dist/` alone or `dist/` without its `Memories/` plus the real folder — not both.

### Trying the login locally
`npm run dev` runs without the login. To try the full sign-in on your machine, with the real login function and a stand-in for CloudFront:

```bash
cd Auth-function && npm install
node tools/make-config.mjs --demo     # set a username, password and 3 questions (hidden input)
cd ../Front-end && npm run dev:auth   # open the printed address in Chrome or Firefox
```

The demo login is saved to `Auth-function/demo/` (git-ignored; only hashes are stored). Run the tool again to change it, then restart `npm run dev:auth`. Safari won't work here: it rejects the secure cookies on `http://localhost`.

### Login function
From `Auth-function/`: `npm run test`, `npm run lint`, and `npm run build` (writes `dist/handler.mjs` for Lambda).

### Tileset tooling (optional)
From `Tile_Creator/`, run `python tile_builder.py` to regenerate the tileset PNG from `museum_tiles_config.json`.

---

## 🏗️ Technical Architecture Workflow

### Startup and sign-in

```text
 StartupGate ──HEAD /Memories/dialogue/00.md──> CloudFront
     │   403 (not signed in)        200 / 404 (signed in: a refresh)
     ▼                                   │
 LoginScreen                             │
   ├─ POST /api/login/start  {username, password}            -> 3 question prompts
   └─ POST /api/login/finish {username, password, answers[3]} -> 3 signed cookies
     │                                   │
     ▼                                   ▼
 loadMemories() (letters from /Memories/dialogue/) ──> App + Phaser game start
```

### Reading a memory

```text
 [ Phaser Game Loop ] ──(player overlaps zone + presses E)──> emit "hotspot-activated"
   InteractionManager   (payload resolved from the MEMORIES manifest)
                                                      │
                                                      ▼ (via EventBus)
 [ React UI ] ──(reads {id, text, imageUrl} from the event payload)
         │
         ├──> Render DialogueBox (paged text) and/or ImageViewer (photo)
         │
         ▼
 On dismiss ──(emit "dialogue-dismissed" / "image-dismissed")──> Phaser unfreezes player
```
