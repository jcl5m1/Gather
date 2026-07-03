# Rational Bezier Curves for Orbital Mechanics

## Summary

While rational quadratic Bezier curves can **exactly** represent geometric ellipses, they **cannot directly** be used for orbital path visualization because of a fundamental difference in how orbits and geometric ellipses are parameterized.

## The Problem

### Geometric Ellipses (Rational Bezier Works)
- Defined relative to the **geometric center** of the ellipse
- Parameterized by **angle θ** from the center
- Position: `(x, y) = (a·cos(θ), b·sin(θ))` + center offset
- Rational quadratic Bezier curves with weight `w = cos(θ/2)` give **zero geometric error**

### Orbital Ellipses (Rational Bezier Doesn't Work Directly)
- Defined relative to the **focus** (where the central body is located)
- Parameterized by **true anomaly ν** from the focus
- Position: `r(ν) = a(1-e²)/(1 + e·cos(ν))`
- The focus is offset from the geometric center by distance `c = a·e`

## Why It Doesn't Work

1. **Different reference points**: Orbits are measured from the focus; geometric ellipses from the center
2. **Different param**eterization**: True anomaly ν ≠ parametric angle θ
3. **Non-linear relationship**: Converting between the two requires solving Kepler's equation

## What Was Implemented

### Created (`rationalBezierCurve.ts`)
- `RationalBezierCurve` class supporting quadratic and cubic rational curves
- `createEllipticalArc()` method for exact geometric ellipse arcs
- Proper handling of weighted control points

### Attempted Integration
- Modified `generateBezierOrbitPoints()` to use 4 rational quadratic curves (one per 90° arc)
- Each arc used weight `w₁ = cos(45°) ≈ 0.7071` for exact geometric representation
- Updated `BezierCurveRenderer` to handle both cubic and quadratic curves

### Result
- The curves created **clover-shaped paths** instead of proper ellipses
- Debug output confirmed: endpoints matched the analytical ellipse, but they were in the wrong coordinate system
- Periapsis was at negative coordinates when it should have been positive

## Current Solution

The code **reverts to the original cubic Bezier approximation**:
- Uses 4 cubic Bezier curves with the "magic number" `k = 0.551915024494`
- Approximates the ellipse centered at its geometric center
- Then offsets the entire ellipse so one focus is at the origin
- This gives good visual approximation for orbital paths

## Future Work

To achieve an **exact** rational Bezier representation of orbital paths would require:

1. **Custom rational Bezier curves** parameterized by true anomaly, not geometric angle
2. **Control point calculation** that accounts for the focus-based coordinate system
3. **Weight optimization** for each arc segment based on eccentricity
4. **Research into conic section representation** from focus points rather than centers

This is a non-trivial problem in computational geometry that goes beyond standard ellipse representation.

## Files Modified

- `src/moonOrbitSim/rationalBezierCurve.ts` - New rational Bezier class (kept for potential future use)
- `src/moonOrbitSim/orbitUtils.ts` - Attempted integration, then reverted to cubic curves
- `src/moonOrbitSim/trajectory.ts` - Updated renderer to handle both curve types
- `src/moonOrbitSim/orbitalBody.ts` - Time warp optimization still uses rational Beziers for the 1D time function
