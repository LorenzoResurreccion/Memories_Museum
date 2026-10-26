# 🏛️ The Living Museum: An Anniversary Journey

A bespoke, interactive 2.5D retro side-scrolling video game built as a personalized anniversary gift. The player explores a warm-cream minimalist art gallery, controlling a custom 16-bit character sprite across a hardwood floor depth plane. Walking up to a framed pixel canvas and pressing an interaction key triggers a React UI overlay that shows a high-resolution couple photo and streams sentimental dialogue letters.

The game is fully self-contained and static — all memory content is authored directly in the app as a static module (`src/data/memories.js`), so there is no backend server to run or deploy.

---

## 🎨 Core Gameplay Features

*   **2.5D Walkable Gallery Depth:** Vertical Y-sorting within a side-scrolling layout. The player moves left/right and up/down across the floor, dynamically sorting behind or in front of benches, props, and decor.
*   **Bounded Infinite Hallway:** The gallery is procedurally stitched from repeating segments as the player walks, bounded on the right by the number of authored memories. Segments generate and recycle on the fly to keep the runtime light.
*   **Interaction Zones:** Invisible zones span the full width of each framed canvas. Standing in front of one shows a floating `[E]` prompt; pressing `E` opens its dialogue and/or photo.
*   **Wall Paintings:** Every framed canvas displays a pixel-art painting for its memory, so each memory shows up both as a floor interaction zone and as art hanging in its frame. Paintings are purely visual — no interaction, no collision — and fall back to a placeholder until real art is authored.
*   **Phaser-to-React State Bridge:** A lightweight decoupled runtime. Player interaction inside the WebGL game canvas dispatches custom events through a shared EventBus to trigger smooth HTML/React UI overlays.
*   **Light Runtime Footprint:** Pixel assets ship with the game; heavy media (high-res photos, audio) is intended to be served from external/CDN storage rather than bundled.

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

### Hosting (target)
*   **Static hosting (e.g. Amazon S3 + CloudFront):** The build is a static site. Heavy media can live in a separate bucket delivered via CDN.

---

## 🧩 Memory Content Model

Memories are authored in a static manifest, `Front-end/src/data/memories.js` (`MEMORIES`), keyed by contiguous index `0 .. N-1`. Each entry carries:

| Property   | Required | Description                                        |
| ---------- | -------- | -------------------------------------------------- |
| `text`     | yes      | Array of dialogue pages (the letter content)       |
| `imageUrl` | no       | Link to the high-res photo (`null` if none)        |

Wall paintings are authored in a parallel static source, `Front-end/src/data/paintings.js` (`PAINTINGS`), keyed by the same `Memory_Index`. Each entry names the texture for that memory's frame; entries start as a shared placeholder and are swapped for real pixel art later by editing the references (plus adding the asset and loading it in `preload()`), with no other code change.

The gallery is a bounded "infinite hallway": the authored count `N` sets how far it extends (`finalSegmentIndex = N ≥ 1 ? floor((N-1)/6) : 0`). The Tiled maps hold only object *positions/sizes* on a type-aware `Object Layer 1` — `memory_zone` objects become interaction zones (resolved at runtime to a manifest entry, or a single "future memory" placeholder page past the authored memories) and `painting` objects become the wall art; zone indexing ignores paintings, so adding art never shifts a memory. The player start is a `player_spawn` object in the spawn object layer, with an in-bounds floor fallback.

---

## 📂 Project Structure

```text
Memories_Museum/
├── Front-end/                 # React + Phaser app (Vite), built and hosted statically
│   ├── public/
│   │   └── assets/            # Pixel assets only (tiny footprint)
│   │       ├── maps/          # Exported Tiled .json maps
│   │       ├── tilesets/      # 16-bit environment tiles (.png)
│   │       └── sprites/       # 4-way character walking sheets
│   └── src/
│       ├── components/        # React components (GameCanvas, DialogueBox, ImageViewer)
│       ├── data/             # memories.js — static MEMORIES manifest
│       ├── phaser/            # Phaser scene, controllers, segment/interaction subsystems, EventBus bridge
│       └── App.jsx            # Coordinates React and Phaser state
│
└── Tile_Creator/              # Python tool that compiles tileset PNGs from a JSON config
```

---

## 🚀 Local Development Setup

### Frontend
1. Navigate to the client directory: `cd Front-end`
2. Install npm packages: `npm install`
3. Start the hot-reloading dev server: `npm run dev`

### Tileset tooling (optional)
From `Tile_Creator/`, run `python tile_builder.py` to regenerate the tileset PNG from `museum_tiles_config.json`.

---

## 🏗️ Technical Architecture Workflow

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
