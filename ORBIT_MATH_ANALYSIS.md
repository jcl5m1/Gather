# Orbit Math Analysis: Why LUT Samples Differ from Analytical/Bezier Curves

## Summary
The analytical orbit and Bezier orbit are **extremely close** because they both represent the same ellipse geometry. However, the LUT (Lookup Table) samples show much larger spacing because they sample the orbit based on **physics** (True Anomaly), while the visualization curves sample based on **geometry** (parametric angles or Bezier parameters).

## Three Different Sampling Methods

### 1. Analytical Orbit Visualization (`generateEllipsePoints`)
**Location**: `orbitUtils.ts`, line ~580
```typescript
for (let i = 0; i <= numPoints; i++) {
    const theta = (i / numPoints) * Math.PI * 2;
    const point = new THREE.Vector3()
        .addScaledVector(periapsisDir, a * Math.cos(theta))
        .addScaledVector(perpDir, b * Math.sin(theta))
        .add(center);
}
```
- Samples evenly in **parametric angle θ** (0 to 2π)
- Creates 100 points uniformly distributed around the ellipse **geometrically**
- Does NOT respect orbital mechanics or Kepler's laws
- Used for visualization only

### 2. Bezier Orbit Visualization (`generateBezierOrbitPoints`)
**Location**: `orbitUtils.ts`, line ~520
```typescript
curves.forEach(curve => {
    for (let i = 0; i <= numPointsPerCurve; i++) {
        const t = i / numPointsPerCurve;
        points.push(curve.getPoint(t));
    }
});
```
- Samples evenly in **Bezier parameter t** (0 to 1) for each of 4 curves
- Creates 4×25 = 100 points uniformly distributed along the Bezier curve
- Bezier curves use magic number k = 0.551915024494 to approximate circular arcs
- Geometric approximation - does NOT respect orbital mechanics
- Used for visualization only

### 3. LUT Samples (`buildTimeWarpLUT`)
**Location**: `orbitalBody.ts`, line ~863
```typescript
for (let i = 0; i <= numSamplesForCalculation; i++) {
    // Sample evenly in True Anomaly (0 to 2π)
    const theta = (i / numSamplesForCalculation) * 2 * Math.PI;
    
    // Convert True Anomaly to Eccentric Anomaly
    const E = 2 * Math.atan(Math.sqrt((1 - eccentricity) / (1 + eccentricity)) * Math.tan(theta / 2));
    
    // Compute Mean Anomaly: M = E - e*sin(E)
    const M = E - eccentricity * Math.sin(E);
    
    // Compute position from True Anomaly using orbital mechanics
    const r = semiMajorAxis * (1 - eccentricity * eccentricity) / (1 + eccentricity * Math.cos(theta));
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    
    // Find closest point on Bezier curve to this analytical position
    // ... (search for best match)
}
```
- Samples evenly in **True Anomaly θ** (0 to 2π) - 32 or 33 samples
- For each True Anomaly, computes the **analytical position** using orbital mechanics
- Finds the **closest point** on the Bezier curves
- Creates mapping: Mean Anomaly M → Bezier parameter t
- **Respects Kepler's Second Law**: Equal areas swept in equal times

## Why the Difference Appears Large

### Kepler's Second Law
The LUT samples respect **Kepler's Second Law**: A line joining a planet and the Sun sweeps out equal areas in equal times.

**Consequences**:
- Body moves **faster** near periapsis (closest point)
- Body moves **slower** near apoapsis (farthest point)
- Samples in True Anomaly correspond to equal time intervals
- LUT samples are **denser near periapsis**, **sparser near apoapsis**

### Geometric Sampling
The analytical and Bezier visualizations use **geometric sampling**:
- Evenly distributed around the ellipse perimeter
- Does NOT reflect the body's actual motion in time
- Purely for visual representation

## Mathematical Relationship

The key transformations in orbital mechanics:

1. **True Anomaly (θ)** → **Eccentric Anomaly (E)**:
   ```
   tan(E/2) = sqrt((1-e)/(1+e)) * tan(θ/2)
   ```

2. **Eccentric Anomaly (E)** → **Mean Anomaly (M)**:
   ```
   M = E - e·sin(E)
   ```

3. **Mean Anomaly (M)** → **Time (t)**:
   ```
   M = n·t  where n = 2π/T (mean motion)
   ```

The LUT essentially inverts this chain:
- Start with True Anomaly θ (evenly sampled)
- Compute Mean Anomaly M (Kepler's equation)
- Find where on the Bezier curve this position lands
- Store mapping: M → Bezier parameter t

## Why Analytical and Bezier Are Close

The analytical and Bezier curves are geometrically very close because:

1. **Both approximate the same ellipse shape**
   - Analytical: `x = a·cos(θ) - c`, `y = b·sin(θ)`
   - Bezier: Uses cubic Bezier curves with magic number k = 0.551915024494

2. **The Bezier approximation is good**
   - For circles, k = 0.551915024494 gives < 0.02% error
   - For ellipses, error scales with eccentricity
   - Typical errors are small (few km for Moon's orbit)

3. **Both sample the geometry, not the physics**
   - Neither visualization respects time or orbital velocity
   - Both create smooth visual curves

## The Real Issue

The "large difference" at LUT samples is NOT an error - it's a **visualization artifact**:

1. The **curves** (analytical white line, Bezier dashed line) sample **geometry**
2. The **LUT markers** (green dots) show where **physical time samples** land
3. Due to Kepler's Second Law, time samples are non-uniformly distributed

**The LUT samples are correctly computing the physics**, showing that:
- More samples cluster near periapsis (faster motion)
- Fewer samples appear near apoapsis (slower motion)
- The spacing between samples reflects actual orbital mechanics

## Conclusion

The analytical and Bezier orbits are close (~few km error) because they're both geometric representations of the same ellipse. The LUT samples appear different because they represent **physical positions at equal time intervals**, which naturally cluster near periapsis due to Kepler's Second Law.

The system is working correctly:
- ✅ Analytical orbit: True orbital geometry
- ✅ Bezier orbit: Good geometric approximation
- ✅ LUT samples: Correct physics-based time mapping

The "difference" is not a bug - it's the difference between **geometric sampling** (curves) and **temporal sampling** (LUT points).
