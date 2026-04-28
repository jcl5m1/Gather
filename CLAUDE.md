# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gather is a web-based mobile resource-gathering game rendered on a real-scale Earth. The primary project is the **game** (`src/game/`). The repository also contains supporting sub-projects:

1. **game** (`src/game/`) — **PRIMARY PROJECT** — Mobile-first web game (iOS/Android), compiled via webpack; dev server on port 9000
2. **moonOrbitSim** (`src/moonOrbitSim/`) — Full 3D orbital simulation using Three.js, compiled via webpack
3. **lagrange_explorer/** — Standalone HTML/JS files for three-body problem exploration (no build step required); `lagrange_explorer/game.html` is the legacy single-file version of the game

There is also a minor game module **mineGather** (`src/mineGather/`) with its own webpack config.

## Commands

### Development (moonOrbitSim)
```bash
npm start              # Dev server at http://localhost:8000 (webpack-dev-server, hot reload)
npm run build          # Production build to dist/
```

### Development (game)
```bash
npm run start:game     # Dev server at http://localhost:9000/game.html (webpack-dev-server, hot reload)
npm run build:game     # Production build to dist/game.html + dist/game.bundle.js
```

### Development (mineGather)
```bash
npm run start:mine     # Dev server using webpack.mineGather.config.js
npm run build:mine     # Production build
```

### lagrange_explorer (no build)
```bash
open lagrange_explorer/threebody.html      # Earth-Moon three-body explorer
open lagrange_explorer/manifold_tubes.html # 3D manifold tube visualization
open lagrange_explorer/lagrange.html       # Basic Lagrange point explorer
```

### Python backend
```bash
source .venv/bin/activate
python backend/server.py   # FastAPI server on http://localhost:8000
```

### Python research tools
```bash
source .venv/bin/activate
jupyter notebook           # For notebooks in python/
```

## Architecture: game

A mobile-first iOS tap-to-gather game rendered on a real-scale Earth. No external game engine — pure Three.js (npm package, not CDN). Built with webpack + ts-loader; outputs `dist/game.bundle.js` and `dist/game.html`.

```
src/game/
├── index.ts             — entry: wires all modules, owns the render loop
├── index.html           — HTML shell + CSS (no inline JS); loads game.bundle.js
├── constants.ts         — R (Earth radius), HOUSE_*, PAD_*, RES_DIST, SURFACE_RISE
├── resource.ts          — Resource class + RESOURCES array (Wood/Stone/Iron/Coal/Crystal)
├── scene.ts             — createRenderer(), createCamera()
├── earth.ts             — addLighting(), addStars(), addEarth() → returns cloudMesh
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
├── saveState.ts         — saveGame()/loadGame(): localStorage persistence for inventory, transports, refineries, zoom
├── statsPanel.ts        — StatsPanel: resource throughput/rate chart
└── logger.ts            — client-side logger forwarding to dev server GET /log endpoint (sendBeacon-compatible)
```

**Key design points:**
- Real-world scale (R = 6,371,000 m); logarithmic depth buffer handles street-to-planet zoom without z-fighting
- Camera sits directly above north pole (+Y axis), `camera.up = (0,0,-1)` so the view is top-down with -Z as screen-up
- `placeOnSurface(mesh, normal, rise)` in `world.ts` positions and orients any mesh to lie flat on the sphere at a given surface normal
- Zoom lerp: render loop calls `camera.position.lerp(targetPos, 0.07)` and `currentLook.lerp(targetLook, 0.07)` each frame
- Earth textures (atmos/normal/specular) gate the loading screen via a 3-callback counter; clouds load non-blocking and drift via `cloudMesh.rotation.y += 0.00002` per frame
- Dev server runs with HMR/WebSocket client disabled (`hot: false`, `client: false`) and `Cache-Control: no-store` to prevent iOS caching stale bundles; exposes GET+POST `/log` endpoint for client-side logging
- **Config files:** `webpack.game.config.js`, `tsconfig.game.json`

## Architecture: moonOrbitSim

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
- `trajectory.ts` / `transferTrajectory.ts` — Trail and transfer orbit visualization
- `cameraManager.ts` — Camera focus modes and targeting logic
- `plotWindow.ts` — Reusable windowed plots for real-time parameter visualization
- `units.ts` / `unitsVector3.ts` — Type-safe unit wrappers using `safe-units`; physical units are enforced at compile time, preventing dimensional mismatches
- `config.ts` — `G`, `ORBIT_UPDATE_METHOD`, simulation config loaded from `config.json`
- `types.ts` — `Body` data class (serializable, Vector3-aware JSON), `OrbitControls` interface

**Orbit representation:** Orbits are stored as cubic Bezier curves (4 arcs, k=0.551915024494) for visual rendering. A time-warp LUT maps Mean Anomaly → Bezier parameter `t` so that bodies obey Kepler's Second Law during animation.

**Testing:** There is no automated test runner. Testing is done manually via the browser console. The controller is exposed as `window.simulationController`; use `window.simulationController.executeCommand('RESET position:20,5,3 velocity:2,8.5,0 mass:1.0')` for scripted testing. `window.testLambertSolver()` validates the Lambert solver. See `src/moonOrbitSim/COMMAND_INTERFACE.md` for the full command reference.

## Architecture: lagrange_explorer

These are self-contained HTML files that import Three.js from CDN. No build step.

- **`game.html`** — Mobile-first iOS interactive resource-gathering game (the core Gather gameplay). Renders a real-scale Earth (R=6,371,000 m) using Three.js r128 with a logarithmic depth buffer to handle the extreme scale range (street level → planetary). Gameplay: tap resource pads to gather Wood/Stone/Iron/Coal/Crystal; pads sit 200 m from a homebase cylinder at the north pole in a ring. Five discrete zoom levels (street → hood → city → region → planet) with camera lerp animation. Bottom HUD shows live resource counts; flash labels confirm each gather. Touch events are handled for iOS (`touchstart` + `preventDefault`). No build step — fully self-contained.
- **`mobile.html`** — iOS launch/index page (dark space theme, starfield CSS background, card-based navigation) linking to `game.html` and the orbital-tool pages. Configured as an Apple standalone web app (`apple-mobile-web-app-capable`).
- **`threebody.html` + `threebody_worker.js`** — The primary three-body tool. Uses a Web Worker for heavy computation. Implements CR3BP (Circular Restricted Three-Body Problem) in normalized units (distance unit = Earth-Moon distance ≈ 384400 km, time unit = 375200 s). Features: Jacobi constant energy slider, zero-velocity curve (ZVC) forbidden-region overlay, Lyapunov orbit shooting, Poincaré section visualization, stable/unstable manifold generation. L1/L2 orbits and manifolds are gated by whether their respective necks are open (C < C_L1 or C < C_L2).
- **`manifold_tubes.html`** — Three.js 3D manifold tube visualization with RK4 integration
- **`lyapunov_test_suite.html`** — In-browser test suite for Lyapunov orbit computation
- `worker_source.js` — Source that gets stringified and used as a worker blob in some tools

**Physics:** CR3BP equations in the rotating frame with μ = Moon/(Earth+Moon) ≈ 0.01215. Lagrange points found via Newton-Raphson. Manifolds computed by perturbing along eigenvectors of the monodromy matrix.

## Architecture: python/orbitengine

A standalone Python orbital mechanics library used for research and validation, independent of the JavaScript simulation.

- `orbitengine/body.py` — Body representation
- `orbitengine/engine.py` — Numerical integration engine
- `orbitengine/transfer.py` — Transfer orbit calculations
- `orbitengine/trajectorysegment.py` — Trajectory segment representation

Notebooks in `python/` (e.g., `playground.ipynb`, `interactive_intercept.ipynb`) use this library for exploratory research. `python/lagrange.py` and `python/rocket_equation.py` are standalone calculation scripts.

## Key Domain Concepts

- **Normalized units** (lagrange_explorer): distance=384400 km, time=375200 s, velocity=dist/time ≈ 1.025 km/s
- **LUT (time-warp lookup table)**: Maps Mean Anomaly to Bezier parameter; sampled at True Anomaly intervals to respect Kepler's 2nd law. See `ORBIT_MATH_ANALYSIS.md` for a detailed explanation of why LUT points differ from geometric curve samples.
- **Lambert problem**: Solved in `orbitUtils.ts` (`TransferCalculator`); test via `window.testLambertSolver()` in browser console
- **Lyapunov orbits**: Periodic orbits around L1/L2; computed by differential correction (shooting method) in the worker
- **Jacobi constant** C = 2Ω(x,y) − v²: conserved quantity in CR3BP. Higher C = lower energy = more restricted motion. Critical values: C_L1 ≈ 3.1883, C_L2 ≈ 3.1722, C_L3 ≈ 3.0121, C_L4,5 ≈ 2.9879. Necks open as C decreases past each threshold.
- **Zero-velocity curves (ZVC)**: Boundary where v=0, i.e. Ω(x,y) = C/2. Forbidden region (Ω < C/2) rendered as grey overlay. In `threebody.html`, computed on an offscreen canvas at ~400px resolution and cached per camera state.
- **Amplitude↔Jacobi conversion**: `computeAmplitudeFromJacobi(l_x, target_C)` in the worker binary-searches (10 iters) for the Lyapunov orbit amplitude that yields the target Jacobi constant, using C = 2·Ω(x₀, 0) − vy₀² at the orbit's y=0 crossing.
