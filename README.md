# 🏛️ The Living Museum: An Anniversary Journey

A bespoke, interactive 2.5D retro side-scrolling video game built as a personalized anniversary gift. The player explores a warm-cream minimalist art gallery, controlling a custom 16-bit character sprite across a hardwood floor depth plane. Walking up to a framed pixel canvas and pressing an interaction key triggers a React UI overlay that shows a high-resolution couple photo and streams sentimental dialogue letters.

The game is fully self-contained and static — all memory content is authored directly in the Tiled map, so there is no backend server to run or deploy.

---

## 🎨 Core Gameplay Features

*   **2.5D Walkable Gallery Depth:** Vertical Y-sorting within a side-scrolling layout. The player moves left/right and up/down across the floor, dynamically sorting behind or in front of benches, props, and building pieces.
*   **Memory Hotspots:** Invisible interaction zones sit in front of canvases. Standing on one and pressing Space or Enter opens its dialogue and/or photo.
*   **Phaser-to-React State Bridge:** A lightweight decoupled runtime. Player interaction inside the WebGL game canvas dispatches custom events through a shared EventBus to trigger smooth HTML/React UI overlays.
*   **Light Runtime Footprint:** Pixel assets ship with the game; heavy media (high-res photos, audio) is intended to be served from external/CDN storage rather than bundled.

---

## 🛠️ Key Technologies

### Game Engine
*   **Phaser 4:** Drives the 2D rendering pipeline, 4-direction character physics, tilemap collision layers, camera, and interactable hotspot zones.

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

Memories are authored as Tiled objects of type `memory_hotspot` in the map's object layer. Each hotspot carries:

| Property   | Required | Description                                        |
| ---------- | -------- | -------------------------------------------------- |
| `id`       | yes      | Stable identifier for the memory                   |
| `text`     | yes      | JSON array of dialogue pages (the letter content)  |
| `imageUrl` | no       | Link to the high-res photo for the image viewer    |

Hotspots missing `id` or `text` are skipped. A hotspot with neither text nor image shows nothing and does not freeze the player. The player start is a `player_spawn` object in the `spawn` object layer.

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
│       ├── phaser/            # Phaser scene, controllers, and the EventBus bridge
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
 [ Phaser Game Loop ] ──(player overlaps hotspot + key press)──> emit "hotspot-activated"
                                                      │
                                                      ▼ (via EventBus)
 [ React UI ] ──(reads {id, text, imageUrl} from the event payload)
         │
         ├──> Render DialogueBox (paged text) and/or ImageViewer (photo)
         │
         ▼
 On dismiss ──(emit "dialogue-dismissed" / "image-dismissed")──> Phaser unfreezes player
```
