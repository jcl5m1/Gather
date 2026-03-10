# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gather is a resource-gathering automation game with realistic orbital mechanics. It contains two main interactive sub-projects:

1. **moonOrbitSim** (`src/moonOrbitSim/`) — Full 3D orbital simulation using Three.js, compiled via webpack
2. **lagrange_explorer/** — Standalone HTML/JS files for three-body problem exploration (no build step required)

There is also a minor game module **mineGather** (`src/mineGather/`) with its own webpack config.

## Commands

### Development (moonOrbitSim)
```bash
npm start              # Dev server at http://localhost:8000 (webpack-dev-server, hot reload)
npm run build          # Production build to dist/
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
- `orbitUtils.ts` — Orbital element math (Lambert solver, ellipse generation, `generateStateFromOrbitalElements`)
- `trajectory.ts` / `transferTrajectory.ts` — Trail and transfer orbit visualization
- `units.ts` / `unitsVector3.ts` — Type-safe unit wrappers using `safe-units` library
- `config.ts` — `G`, `ORBIT_UPDATE_METHOD`, simulation config loaded from `config.json`
- `types.ts` — `Body` data class (serializable, Vector3-aware JSON), `OrbitControls` interface

**Orbit representation:** Orbits are stored as cubic Bezier curves (4 arcs, k=0.551915024494) for visual rendering. A time-warp LUT maps Mean Anomaly → Bezier parameter `t` so that bodies obey Kepler's Second Law during animation.

**Testing:** The controller is available in the browser console as `window.simulationController`. Use `window.simulationController.executeCommand('RESET position:20,5,3 velocity:2,8.5,0 mass:1.0')` for headless testing. See `src/moonOrbitSim/COMMAND_INTERFACE.md` for the full command reference.

## Architecture: lagrange_explorer

These are self-contained HTML files that import Three.js from CDN. No build step.

- **`threebody.html` + `threebody_worker.js`** — The primary three-body tool. Uses a Web Worker for heavy computation. Implements CR3BP (Circular Restricted Three-Body Problem) in normalized units (distance unit = Earth-Moon distance ≈ 384400 km, time unit = 375200 s). Features: Jacobi constant energy slider, zero-velocity curve (ZVC) forbidden-region overlay, Lyapunov orbit shooting, Poincaré section visualization, stable/unstable manifold generation. L1/L2 orbits and manifolds are gated by whether their respective necks are open (C < C_L1 or C < C_L2).
- **`manifold_tubes.html`** — Three.js 3D manifold tube visualization with RK4 integration
- `worker_source.js` — Source that gets stringified and used as a worker blob in some tools

**Physics:** CR3BP equations in the rotating frame with μ = Moon/(Earth+Moon) ≈ 0.01215. Lagrange points found via Newton-Raphson. Manifolds computed by perturbing along eigenvectors of the monodromy matrix.

## Key Domain Concepts

- **Normalized units** (lagrange_explorer): distance=384400 km, time=375200 s, velocity=dist/time ≈ 1.025 km/s
- **LUT (time-warp lookup table)**: Maps Mean Anomaly to Bezier parameter; sampled at True Anomaly intervals to respect Kepler's 2nd law. See `ORBIT_MATH_ANALYSIS.md` for a detailed explanation of why LUT points differ from geometric curve samples.
- **Lambert problem**: Solved in `orbitUtils.ts` (`TransferCalculator`); test via `window.testLambertSolver()` in browser console
- **Lyapunov orbits**: Periodic orbits around L1/L2; computed by differential correction (shooting method) in the worker
- **Jacobi constant** C = 2Ω(x,y) − v²: conserved quantity in CR3BP. Higher C = lower energy = more restricted motion. Critical values: C_L1 ≈ 3.1883, C_L2 ≈ 3.1722, C_L3 ≈ 3.0121, C_L4,5 ≈ 2.9879. Necks open as C decreases past each threshold.
- **Zero-velocity curves (ZVC)**: Boundary where v=0, i.e. Ω(x,y) = C/2. Forbidden region (Ω < C/2) rendered as grey overlay. In `threebody.html`, computed on an offscreen canvas at ~400px resolution and cached per camera state.
- **Amplitude↔Jacobi conversion**: `computeAmplitudeFromJacobi(l_x, target_C)` in the worker binary-searches (10 iters) for the Lyapunov orbit amplitude that yields the target Jacobi constant, using C = 2·Ω(x₀, 0) − vy₀² at the orbit's y=0 crossing.
