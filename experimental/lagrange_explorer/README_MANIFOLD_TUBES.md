# Lagrange Manifold Tubes - 3D Visualization

## Overview

This Three.js application visualizes the **stable and unstable manifolds** emanating from the L1 and L2 Lagrange points in the Circular Restricted Three-Body Problem (CR3BP). These manifolds are 6-dimensional structures (3D position + 3D velocity) that are projected into 3D space for visualization.

## Key Concepts

### What are Manifold Tubes?

In the CR3BP, Lagrange points L1 and L2 are **unstable equilibrium points**. Small perturbations from these points lead to trajectories that either:

- **Diverge away** (unstable manifolds) - forward integration in time
- **Converge toward** (stable manifolds) - backward integration in time

These trajectories form tube-like structures in phase space, which are crucial for:

- Low-energy transfer trajectories
- Mission design (e.g., Genesis, ARTEMIS missions)
- Understanding chaotic dynamics in the three-body problem

### The Rotating Frame

All computations are performed in the **rotating coordinate frame** where:

- The two primary bodies remain stationary on the x-axis
- The frame rotates with angular velocity ω = 1
- Coriolis and centrifugal forces appear in the equations of motion

## Technical Implementation

### Pre-computed Splines

Rather than computing manifolds on-the-fly, this implementation:

1. **Generates initial conditions** near L1 and L2 with small velocity perturbations
2. **Integrates trajectories** using RK4 (Runge-Kutta 4th order)
3. **Stores results** as Catmull-Rom splines for smooth visualization
4. **Renders tubes** using Three.js TubeGeometry

### Physics Engine

The CR3BP equations of motion are:

```
ẍ - 2ẏ = ∂Ω/∂x
ÿ + 2ẋ = ∂Ω/∂y
z̈ = ∂Ω/∂z
```

Where the effective potential Ω is:

```
Ω = (x² + y² + z²)/2 + (1-μ)/r₁ + μ/r₂
```

### Manifold Generation Parameters

- **Number of manifolds**: 8 per type (32 total)
- **Perturbation magnitude**: 0.001 (velocity space)
- **Integration duration**: 6.0 time units
- **Time step**: 0.01
- **Direction**: Forward (+1) for unstable, backward (-1) for stable

## Features

### Interactive Controls

1. **Mass Ratio (μ) Slider**
   - Range: 0.000003 to 0.5
   - Default: 0.0121 (Earth-Moon system)
   - Dynamically recomputes manifolds and Lagrange points

2. **Tube Opacity**
   - Range: 0.1 to 1.0
   - Adjusts transparency without recomputing

3. **Tube Thickness**
   - Range: 0.005 to 0.05
   - Triggers full manifold regeneration

### Camera Controls

- **Rotate**: Left-click and drag
- **Zoom**: Scroll wheel
- **Pan**: Right-click and drag (or Shift + left-click)

### Color Coding

| Color                   | Manifold Type   |
| ----------------------- | --------------- |
| 🔴 Red (#ff6b6b)        | L1 Unstable     |
| 🔵 Cyan (#4ecdc4)       | L1 Stable       |
| 🟡 Yellow (#ffd93d)     | L2 Unstable     |
| 🟢 Light Cyan (#95e1d3) | L2 Stable       |
| ⚪ White                | Lagrange Points |

## Usage

### Opening the Visualization

Simply open `manifold_tubes.html` in a modern web browser:

```bash
open manifold_tubes.html
```

Or navigate to:

```
file:///path/to/lagrange_explorer/manifold_tubes.html
```

### Exploring Different Systems

Try these interesting mass ratios:

- **Earth-Moon**: μ = 0.0121 (default)
- **Sun-Jupiter**: μ = 0.001
- **Sun-Earth**: μ = 0.000003
- **Equal masses**: μ = 0.5

### Performance Notes

- Manifold computation takes ~100-500ms depending on system
- Loading indicator appears during computation
- Smooth 60 FPS rendering with modern GPUs

## Mathematical Details

### Lagrange Point Calculation

L1 and L2 are found by solving:

```
x - (1-μ)/r₁² ± μ/r₂² = 0
```

Using Newton-Raphson iteration with Hill sphere approximation as initial guess.

### RK4 Integration

Each integration step uses the classic 4th-order Runge-Kutta method:

```
k₁ = f(t, y)
k₂ = f(t + dt/2, y + k₁·dt/2)
k₃ = f(t + dt/2, y + k₂·dt/2)
k₄ = f(t + dt, y + k₃·dt)

y_{n+1} = y_n + (dt/6)(k₁ + 2k₂ + 2k₃ + k₄)
```

### Catmull-Rom Splines

Trajectory points are interpolated using Catmull-Rom splines, which:

- Pass through all control points
- Provide C¹ continuity
- Generate smooth, natural-looking curves

## Future Enhancements

Potential improvements:

- [ ] Add Poincaré sections
- [ ] Implement trajectory picking/selection
- [ ] Export manifold data as JSON
- [ ] Add L3, L4, L5 manifolds
- [ ] Include halo orbit families
- [ ] Add time-varying visualization (animation)
- [ ] Implement WebGL compute shaders for faster generation

## References

1. Koon, W. S., et al. "Dynamical Systems, the Three-Body Problem and Space Mission Design" (2011)
2. Gómez, G., et al. "Dynamics and Mission Design Near Libration Points" (2001)
3. Parker, J. S., Anderson, R. L. "Low-Energy Lunar Trajectory Design" (2014)

## Dependencies

- **Three.js** v0.160.0 (loaded via CDN)
- **OrbitControls** (Three.js addon)

No build process required - runs directly in the browser!

## License

Part of the Gather project by jcl5m1.
