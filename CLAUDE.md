# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gather is a web-based mobile resource-gathering game rendered on a real-scale Earth. The repository is organized **game-first**: the root holds only what's needed to build and run the game (`src/game/`), and every other sub-project has been archived under `experimental/`.

**Repository layout:**
```
├── src/game/                 — THE PROJECT (mobile-first web game)
├── test/                     — vitest suite (test/game/) + loose scratch scripts
├── dist/                     — build output; dist/tiles/ holds the Earth textures (a tracked asset)
├── webpack.game.config.js    — game build config
├── tsconfig.game.json        — game TS config
├── vitest.config.ts          — test runner config (points at test/**)
├── package.json              — default `build`/`start` scripts target the game
└── experimental/             — archived, non-game code (each still buildable):
    ├── moonOrbitSim/         — 3D orbital simulation (own webpack.config.js + tsconfig.json)
    ├── mineGather/           — minor game module stub (own webpack.config.js + tsconfig.json)
    ├── standalone-app/       — old top-level src/ standalone app (index/renderbody/state/utils)
    ├── lagrange_explorer/    — standalone HTML three-body tools + legacy single-file game.html
    ├── python/               — orbital-mechanics research library + notebooks
    ├── backend/, main.py      — FastAPI (backend/server.py) + Flask (main.py) servers
    ├── templates/, gamedata.json
    ├── game-tools/           — Earth-tile generation scripts (generate_earth_tiles.py, etc.)
    └── ORBIT_MATH_ANALYSIS.md, RATIONAL_BEZIER_ORBITS.md, playground.ipynb, ...
```

Nothing in `experimental/` is imported by the game; it is kept for reference and can still be built via the `:moon` / `:mine` npm scripts below.

## Commands

### Development (game — the default)
```bash
npm start              # Dev server at http://localhost:9010/ (serves the game at root)
npm run build          # Production build to dist/ (game.bundle.js + index.html)
npm run start:game     # Alias of `npm start`
npm run build:game     # Alias of `npm run build`
```

### Tests
```bash
npm test               # vitest run (suite in test/game/)
npm run test:watch     # vitest watch mode
npm run sim            # headless simulation at 10x via GameEngine (no UI); writes
                       # per-event logs to logs/headless-sim.jsonl + a summary.txt.
                       # Runner: test/game/headlessSim.ts (reusable runHeadlessSim()).
npm run sim:100x       # same headless sim at 100x (SIM_TIMESCALE=100)
```

The test suite is comprehensive and headless-only (pure logic + Three.js math, no
DOM/WebGL): resource model & haul accounting, transport/dispatch, request queue &
supply-chain tree, refinery/power-plant/oil-well production, save/load round-trip,
tech tree, world build, engine lifecycle/events, and full end-to-end integration
scenarios (steel & gasoline pipelines, source depletion). CI runs the suite + a
100x sim as a **non-blocking** `test` job in `.github/workflows/deploy.yml`
(`continue-on-error`, not a dependency of deploy), so failures surface without
ever holding up a Pages deploy; sim logs upload as a build artifact.

### Archived projects (in experimental/, still buildable)
```bash
npm run start:moon     # moonOrbitSim dev server (experimental/moonOrbitSim/webpack.config.js), port 8000
npm run build:moon     # moonOrbitSim production build
npm run start:mine     # mineGather dev server (experimental/mineGather/webpack.config.js)
npm run build:mine     # mineGather production build
```

### lagrange_explorer (no build step)
```bash
open experimental/lagrange_explorer/threebody.html      # Earth-Moon three-body explorer
open experimental/lagrange_explorer/manifold_tubes.html # 3D manifold tube visualization
open experimental/lagrange_explorer/lagrange.html       # Basic Lagrange point explorer
```

### Python backend / research tools
```bash
source .venv/bin/activate
python experimental/backend/server.py   # FastAPI server on http://localhost:8000
jupyter notebook                         # For notebooks in experimental/python/
```

## Architecture: game

A mobile-first iOS tap-to-gather game rendered on a real-scale Earth. No external game engine — pure Three.js (npm package, not CDN). Built with webpack + ts-loader; outputs `dist/game.bundle.js` and `dist/index.html` (the game shell), served at the dev-server root on port 9010.

```
src/game/
├── index.ts             — entry: wires all modules, owns the render loop; drives sim ONLY via engine.ts
├── engine.ts            — GameEngine: owns & advances ALL simulation state (step/createRequest/cancelRequest/add*/removeStructure). The UI and the headless runner both drive this same API, so they execute identical simulation code. Reports back via an EngineListener (UI → HUD/notify/save; headless → log files).
├── index.html           — HTML shell + CSS (no inline JS); loads game.bundle.js
├── constants.ts         — R (Earth radius), HOUSE_*, PAD_*, RES_DIST, SURFACE_RISE
├── resource.ts          — Resource class + RESOURCES array (Wood/Stone/Iron/Coal/Crystal)
├── scene.ts             — createRenderer(), createCamera()
├── earth.ts             — addLighting(), addStars(), addEarth() → returns cloudMesh; Earth shaders
├── earthLOD.ts          — level-of-detail tile swapping (dist/tiles/L1, L2) as you zoom
├── terrainGen.ts        — procedural terrain generation (shader-based)
├── geo.ts               — lat/lon ↔ 3D surface-vector helpers
├── world.ts             — buildWorld(): places ground patch, homebase cylinder, resource pads on sphere surface
├── zoomController.ts    — ZoomController: 5 zoom levels (street→planet), camera lerp state; ZoomSave for persistence
├── hud.ts               — HUD: builds resource count DOM, update(res)
├── flash.ts             — Flash: "+1 Wood" tap feedback label
├── inputHandler.ts      — InputHandler: raycasting, touchstart + click, scale-bounce on gather
├── dragOrbitHandler.ts  — DragOrbitHandler: two-finger drag rotates globe; quaternion-based orbit camera
├── homebaseIcon.ts      — HomebaseIcon: screen-space DOM icon overlay pinned to homebase position
├── buildMenu.ts         — BuildMenu: DOM panel + confirmation modal for placing Refinery/Transport structures
├── transport.ts         — Transport (abstract), TruckTransport: surface-crawling resource haulers; TransportSave
├── refinery.ts          — Refinery: converts raw resources; constants REFINERY_W/H/D, REFINERY_IRON_COST/STONE_COST; RefinerySave
├── oilWell.ts / powerPlant.ts / orbitalDebris.ts — additional structures/effects
├── tech.ts / techPanel.ts — tech tree + panel; autoFuel logic
├── saveState.ts         — saveGame()/loadGame(): localStorage persistence for inventory, transports, refineries, zoom
├── statsPanel.ts        — StatsPanel: resource throughput/rate chart
└── logger.ts            — client-side logger forwarding to dev server GET/POST /log endpoint (sendBeacon-compatible)
```
(Additional modules: `homebase.ts`, `resourceNode.ts`, `structure.ts`, `tooltip.ts`, `notify.ts`, `uiDefaults.ts`.)

**Key design points:**
- Real-world scale (R = 6,371,000 m); logarithmic depth buffer handles street-to-planet zoom without z-fighting
- Camera sits directly above north pole (+Y axis), `camera.up = (0,0,-1)` so the view is top-down with -Z as screen-up
- `placeOnSurface(mesh, normal, rise)` in `world.ts` positions and orients any mesh to lie flat on the sphere at a given surface normal
- Zoom lerp: render loop calls `camera.position.lerp(targetPos, 0.07)` and `currentLook.lerp(targetLook, 0.07)` each frame
- Earth textures (atmos/normal/specular) gate the loading screen via a 3-callback counter; clouds load non-blocking and drift via `cloudMesh.rotation.y += 0.00002` per frame
- Dev server (port 9010) runs with HMR disabled (`hot: false`) and `Cache-Control: no-store` to prevent iOS caching stale bundles; exposes GET+POST `/log` and a `/build-time` endpoint for client-side logging / stale-bundle detection
- **Config files:** `webpack.game.config.js`, `tsconfig.game.json`

**Testing:** vitest, pure-logic only (no JSDOM — tests must avoid window/document/HTMLElement). The suite lives in `test/game/*.test.ts` and imports production code from `../../src/game/`. Run with `npm test`. `vitest.config.ts` include glob is `test/**/*.test.ts`.

## Architecture: moonOrbitSim (archived — experimental/moonOrbitSim/)

The simulation follows a command-pattern architecture where the UI is fully decoupled from physics.

```
MoonOrbitSimulation (app.ts)
├── GameLoop (gameLoop.ts)        — Three.js render loop, physics updates, scene management
│   ├── OrbitalBody[]             — Individual bodies with rendering + orbit math
│   └── CameraManager             — Camera controls and targeting
├── SimulationController          — Wraps CommandProcessor, exposed as window.simulationController
│   └── CommandProcessor          — Text command interface (RESET, ADD_BODY, SET_TIME_SCALE, etc.)
└── UIManager (uiManager.ts)      — Sends text commands to controller; never calls physics directly
```

**Key files:**
- `orbitalBody.ts` — Core body class: renders body + manages Bezier orbit path + time-warp LUT
- `orbitUtils.ts` — Largest file (~1900 LOC): Lambert solver, ellipse generation, `BezierCurve` class, `generateStateFromOrbitalElements`, `TransferCalculator`
- `uiManager.ts` — Largest UI file (~2300 LOC): all DOM controls; sends text commands to controller, never touches physics
- `commandProcessor.ts` — Parses and dispatches all commands (RESET, ADD_BODY, SET_TIME_SCALE, etc.)
- `trajectory.ts` / `transferTrajectory.ts` — Trail and transfer orbit visualization (`trajectory.ts` lazily `require`s `gpuOrbitCompute.ts`)
- `cameraManager.ts` — Camera focus modes and targeting logic
- `plotWindow.ts` — Reusable windowed plots for real-time parameter visualization
- `units.ts` / `unitsVector3.ts` — Type-safe unit wrappers using `safe-units`; physical units are enforced at compile time, preventing dimensional mismatches
- `config.ts` — `G`, `ORBIT_UPDATE_METHOD`, simulation config loaded from `config.json`
- `types.ts` — `Body` data class (serializable, Vector3-aware JSON), `OrbitControls` interface

**Orbit representation:** Orbits are stored as cubic Bezier curves (4 arcs, k=0.551915024494) for visual rendering. A time-warp LUT maps Mean Anomaly → Bezier parameter `t` so that bodies obey Kepler's Second Law during animation.

**Testing:** There is no automated test runner. Testing is done manually via the browser console. The controller is exposed as `window.simulationController`; use `window.simulationController.executeCommand('RESET position:20,5,3 velocity:2,8.5,0 mass:1.0')` for scripted testing. `window.testLambertSolver()` validates the Lambert solver. See `experimental/moonOrbitSim/COMMAND_INTERFACE.md` for the full command reference.

## Architecture: lagrange_explorer (archived — experimental/lagrange_explorer/)

These are self-contained HTML files that import Three.js from CDN. No build step.

- **`game.html`** — Legacy single-file version of the Gather game (superseded by `src/game/`). Renders a real-scale Earth (R=6,371,000 m) using Three.js r128 with a logarithmic depth buffer to handle the extreme scale range (street level → planetary). Gameplay: tap resource pads to gather Wood/Stone/Iron/Coal/Crystal; pads sit 200 m from a homebase cylinder at the north pole in a ring. Five discrete zoom levels (street → hood → city → region → planet) with camera lerp animation.
- **`mobile.html`** — iOS launch/index page (dark space theme, starfield CSS background, card-based navigation) linking to `game.html` and the orbital-tool pages. Configured as an Apple standalone web app (`apple-mobile-web-app-capable`).
- **`threebody.html` + `threebody_worker.js`** — The primary three-body tool. Uses a Web Worker for heavy computation. Implements CR3BP (Circular Restricted Three-Body Problem) in normalized units (distance unit = Earth-Moon distance ≈ 384400 km, time unit = 375200 s). Features: Jacobi constant energy slider, zero-velocity curve (ZVC) forbidden-region overlay, Lyapunov orbit shooting, Poincaré section visualization, stable/unstable manifold generation. L1/L2 orbits and manifolds are gated by whether their respective necks are open (C < C_L1 or C < C_L2).
- **`manifold_tubes.html`** — Three.js 3D manifold tube visualization with RK4 integration
- **`lyapunov_test_suite.html`** — In-browser test suite for Lyapunov orbit computation
- `worker_source.js` — Source that gets stringified and used as a worker blob in some tools

**Physics:** CR3BP equations in the rotating frame with μ = Moon/(Earth+Moon) ≈ 0.01215. Lagrange points found via Newton-Raphson. Manifolds computed by perturbing along eigenvectors of the monodromy matrix.

## Architecture: python/orbitengine (archived — experimental/python/orbitengine/)

A standalone Python orbital mechanics library used for research and validation, independent of the JavaScript simulation.

- `orbitengine/body.py` — Body representation
- `orbitengine/engine.py` — Numerical integration engine
- `orbitengine/transfer.py` — Transfer orbit calculations
- `orbitengine/trajectorysegment.py` — Trajectory segment representation

Notebooks in `experimental/python/` (e.g., `playground.ipynb`, `interactive_intercept.ipynb`) use this library for exploratory research. `experimental/python/lagrange.py` and `experimental/python/rocket_equation.py` are standalone calculation scripts.

## Key Domain Concepts

- **Normalized units** (lagrange_explorer): distance=384400 km, time=375200 s, velocity=dist/time ≈ 1.025 km/s
- **LUT (time-warp lookup table)**: Maps Mean Anomaly to Bezier parameter; sampled at True Anomaly intervals to respect Kepler's 2nd law. See `experimental/ORBIT_MATH_ANALYSIS.md` for a detailed explanation of why LUT points differ from geometric curve samples.
- **Lambert problem**: Solved in `orbitUtils.ts` (`TransferCalculator`); test via `window.testLambertSolver()` in browser console
- **Lyapunov orbits**: Periodic orbits around L1/L2; computed by differential correction (shooting method) in the worker
- **Jacobi constant** C = 2Ω(x,y) − v²: conserved quantity in CR3BP. Higher C = lower energy = more restricted motion. Critical values: C_L1 ≈ 3.1883, C_L2 ≈ 3.1722, C_L3 ≈ 3.0121, C_L4,5 ≈ 2.9879. Necks open as C decreases past each threshold.
- **Zero-velocity curves (ZVC)**: Boundary where v=0, i.e. Ω(x,y) = C/2. Forbidden region (Ω < C/2) rendered as grey overlay. In `threebody.html`, computed on an offscreen canvas at ~400px resolution and cached per camera state.
- **Amplitude↔Jacobi conversion**: `computeAmplitudeFromJacobi(l_x, target_C)` in the worker binary-searches (10 iters) for the Lyapunov orbit amplitude that yields the target Jacobi constant, using C = 2·Ω(x₀, 0) − vy₀² at the orbit's y=0 crossing.
