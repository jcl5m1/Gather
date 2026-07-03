# Gather

A mobile-first web game rendered on a real-scale Earth: tap to gather resources
(Wood/Stone/Iron/Coal/Crystal), then build refineries and transport trucks to
automate production. Pure Three.js, no game engine.

The repository is organized **game-first** — the root contains only what's needed
to build and run the game (`src/game/`). All other sub-projects (an orbital-mechanics
simulation, three-body tools, Python research) are archived under `experimental/`
and are not part of the game build.

## Setup

### Prerequisites
- Node.js and npm

### Installation

```bash
npm install
```

## Run the game

```bash
npm start          # dev server at http://localhost:9010/ (hot-served game)
```

`npm run start:game` is an alias of `npm start`.

### Build for production

```bash
npm run build      # outputs dist/game.bundle.js + dist/index.html
```

`npm run build:game` is an alias of `npm run build`.

### Tests

```bash
npm test           # run the vitest suite (test/game/)
npm run test:watch # watch mode
```

## Project layout

```
src/game/            THE game (entry: src/game/index.ts)
test/game/           vitest suite (pure logic, no DOM)
dist/tiles/          Earth textures loaded at runtime (tracked asset)
webpack.game.config.js, tsconfig.game.json, vitest.config.ts
experimental/        archived, non-game code (see below)
```

See [CLAUDE.md](CLAUDE.md) for the full architecture reference.

## Archived sub-projects (`experimental/`)

These are kept for reference and still build/run, but are independent of the game:

| Path | What it is | How to run |
|------|------------|------------|
| `experimental/moonOrbitSim/` | 3D orbital simulation (Three.js) | `npm run start:moon` / `npm run build:moon` (port 8000) |
| `experimental/mineGather/` | minor game-module stub | `npm run start:mine` / `npm run build:mine` |
| `experimental/lagrange_explorer/` | standalone three-body HTML tools + legacy single-file game | `open experimental/lagrange_explorer/threebody.html` |
| `experimental/backend/server.py` | FastAPI backend | `python experimental/backend/server.py` (port 8000) |
| `experimental/python/` | orbital-mechanics research library + notebooks | `jupyter notebook` |

The Python tools need a virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install fastapi uvicorn
```
