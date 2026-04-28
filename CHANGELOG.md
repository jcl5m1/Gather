# Gather — Visual FX Changelog

All visual shader and rendering changes made to the Earth rendering pipeline.

---

## Atmosphere — Outer Glow

The outer atmospheric halo is a fullscreen-quad shader rendered over the planet.
It is split into **day-side** and **night-side** components blended across the terminator.

### Sliders — Outer Glow

```
┌─────────────────┬───────────────────────────────────────────────────────────────┬─────────┬──────────────┐
│ Slider Label    │ Description                                                   │ Range   │ Default      │
├─────────────────┼───────────────────────────────────────────────────────────────┼─────────┼──────────────┤
│ Day Opacity     │ Brightness of the halo on the sun-facing limb                 │ 0 – 2   │ 1.0          │
│ Night Opacity   │ Brightness of the halo on the anti-sun limb                   │ 0 – 2   │ 0.4          │
│ Day Width       │ Tightness of the outer glow ring on the day side (higher=narrow)│ 1 – 30 │ 20.0         │
│ Night Width     │ Tightness of the outer glow ring on the night side             │ 1 – 30  │ 20.0         │
└─────────────────┴───────────────────────────────────────────────────────────────┴─────────┴──────────────┘
```

### Internals

```
┌─────────────────┬────────────────────┐
│ Uniform         │ Setter method      │
├─────────────────┼────────────────────┤
│ uDayOpacity     │ setDayOpacity()    │
│ uNightOpacity   │ setNightOpacity()  │
│ uDayWidth       │ setDayWidth()      │
│ uNightWidth     │ setNightWidth()    │
└─────────────────┴────────────────────┘
```

Blend formula:
```glsl
float NdotS_outer  = dot(normalize(qClose), uSunDir);
float frontWeight  = smoothstep(-0.3, 0.3, NdotS_outer);
float glowIntensity = mix(uNightOpacity, uDayOpacity, frontWeight);
float rimWidth      = mix(1.0 / uNightWidth, 1.0 / uDayWidth, frontWeight);
```

---

## Atmosphere — Inner Glow

A secondary fullscreen-quad pass renders a blue/teal haze on the **dayside limb**
(the lit edge of the planet as seen from space).

### Sliders — Inner Glow

```
┌──────────────────┬───────────────────────────────────────────────────────────┬─────────┬─────────┐
│ Slider Label     │ Description                                               │ Range   │ Default │
├──────────────────┼───────────────────────────────────────────────────────────┼─────────┼─────────┤
│ Opacity          │ Overall brightness of the inner atmospheric haze          │ 0 – 2   │ 1.0     │
│ Width            │ How far inward the glow reaches from the limb             │ 0.01–0.5│ 0.25    │
└──────────────────┴───────────────────────────────────────────────────────────┴─────────┴─────────┘
```

### Internals

```
┌───────────────┬────────────────────┐
│ Uniform       │ Setter method      │
├───────────────┼────────────────────┤
│ uInnerOpacity │ setInnerOpacity()  │
│ uInnerWidth   │ setInnerWidth()    │
└───────────────┴────────────────────┘
```

The inner day mask uses `smoothstep(NdotL)` — effect appears on the **lit/dayside**:
```glsl
float innerDayMask = smoothstep(0.0, 0.3, NdotL);   // dayside only
float innerLimb    = exp(-pow((1.0 - t) / uInnerWidth, 2.0)) * step(0.0, 1.0 - t);
float innerGlow    = innerLimb * uInnerOpacity * innerDayMask;
```

---

## Night-side Texture Ambient

The dark-side terrain texture baseline is controlled by `uAmbient` on the
daylight overlay shader. Keeps the night side visible but dark.

```
┌──────────────┬─────────────────────────────────────────┬─────────┬─────────┐
│ Uniform      │ Description                             │ Range   │ Default │
├──────────────┼─────────────────────────────────────────┼─────────┼─────────┤
│ uAmbient     │ Minimum illumination on the night side  │ 0 – 1   │ 0.1     │
└──────────────┴─────────────────────────────────────────┴─────────┴─────────┘
```

---

## Ocean Specular Reflection

A fullscreen-quad shader (`OceanSpecular`, render order 18) ray-casts against
the planet sphere, identifies ocean pixels via the procedural height field
(`height < shorelineLevel`), and applies **Blinn-Phong specular** using the
true per-pixel view and sun directions.

### Defaults

```
┌────────────────┬────────────────────────────────────────────────────┬──────────────┐
│ Uniform        │ Description                                        │ Default      │
├────────────────┼────────────────────────────────────────────────────┼──────────────┤
│ uSpecPower     │ Shininess exponent — lower = wider, softer glint   │ 40.0         │
│ uSpecIntensity │ Overall brightness of the highlight                │ 0.75         │
│ uSpecColor     │ Tint of the specular glint                         │ #D9F2FF      │
└────────────────┴────────────────────────────────────────────────────┴──────────────┘
```

- `NdotL` kills specular on the night side — no highlight where the sun doesn't shine.
- Shoreline threshold stays in sync with terrain slider values automatically.
- No ambient floor — ocean lit only by the Blinn-Phong highlight itself.

---

## Orbital Debris

**Class:** `OrbitalDebris` in `src/game/orbitalDebris.ts`

10,000 particles rendered as short white streak segments with alpha-faded tails.
All orbital mechanics run entirely on the GPU — only `uTime` (one float) is
uploaded per frame.

### Geometry

```
┌───────────────┬───────────────────────────────────────────────────────────────┐
│ Attribute     │ Contents                                                      │
├───────────────┼───────────────────────────────────────────────────────────────┤
│ aOrbit.xyz    │ (inclination, RAAN, M0) — orbital plane + starting angle      │
│ aOrbit.w      │ altFrac ∈ [-1, +1] — maps to altitude within the shell       │
│ aVertRole     │ 0.0 = head (bright),  1.0 = tail (transparent)               │
└───────────────┴───────────────────────────────────────────────────────────────┘
```

### Altitude band

```
┌──────────────────┬───────────────────────┐
│ Parameter        │ Value                 │
├──────────────────┼───────────────────────┤
│ Base altitude    │ 2,100 km (2.1 Mm)     │
│ ± spread         │ 2,000 km (2.0 Mm)     │
│ Bottom of range  │ ~100 km               │
│ Top of range     │ ~4,100 km             │
│ Total band       │ ~4,000 km (4 Mm)      │
└──────────────────┴───────────────────────┘
```

### Physics

```
┌─────────────────────┬───────────────────────────────────────────────────────┐
│ Constant            │ Value                                                 │
├─────────────────────┼───────────────────────────────────────────────────────┤
│ GM (Earth)          │ 3.986004418 × 10¹⁴  m³/s²                            │
│ Velocity law        │ v = sqrt(GM / r)  — vis-viva for circular orbit       │
│ Angular velocity    │ ω = sqrt(GM / r³) — computed per-particle in shader   │
│ Streak arc          │ 0.012 rad (~0.69°)                                    │
│ Blending            │ Additive — bright over dark sky                       │
└─────────────────────┴───────────────────────────────────────────────────────┘
```

Particles at ~100 km altitude orbit at ~7,900 m/s; particles at ~4,100 km
orbit at ~5,800 m/s — producing visible differential drift across the shell.

### Fragment shader

```glsl
float alpha = 1.0 - vRole;
alpha = alpha * alpha;              // quadratic fade toward tail
gl_FragColor = vec4(1.0, 1.0, 1.0, alpha * 0.85);
```

---

## Time Scale Controls

A pill-shaped bar fixed at the **bottom-centre** of the screen controls the
speed of the orbital debris simulation.

```
┌─────────┬──────────────────────┬──────────────────────────────────┐
│ Button  │ Action               │ Effect                           │
├─────────┼──────────────────────┼──────────────────────────────────┤
│  ◀◀     │ timeScale × 0.1      │ Slow down 10× per press          │
│  label  │ Display only         │ Shows current multiplier         │
│  ▶▶     │ timeScale × 10.0     │ Speed up 10× per press           │
└─────────┴──────────────────────┴──────────────────────────────────┘
```

```
┌──────────────────┬───────────────┐
│ Limit            │ Value         │
├──────────────────┼───────────────┤
│ Minimum scale    │ 0.0001×       │
│ Maximum scale    │ 1,000,000×    │
└──────────────────┴───────────────┘
```

Label formatting:
```
┌─────────────────┬──────────────┐
│ Internal value  │ Displays as  │
├─────────────────┼──────────────┤
│ 0.1             │ 1/10×        │
│ 0.01            │ 1/100×       │
│ 1               │ 1×           │
│ 1000            │ 1k×          │
│ 1,000,000       │ 1.0M×        │
└─────────────────┴──────────────┘
```

Only `orbitalDebris.update(dt * timeScale)` is scaled — camera, UI, and all
other game logic are unaffected.

---

## Variable Rename Reference

```
┌─────────────────────┬────────────────────────────────────────────────────────┐
│ Old name            │ New name                                               │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Glow Shape          │ Outer Glow  (section heading)                          │
│ Rim Front           │ Day Width                                              │
│ Rim Back            │ Night Width                                            │
│ Glow Front          │ Day Opacity                                            │
│ Glow Back           │ Night Opacity                                          │
│ Inner Limb Glow     │ Inner Glow  (section heading)                          │
│ uRimFront           │ uDayWidth                                              │
│ uRimBack            │ uNightWidth                                            │
│ uGlowFront          │ uDayOpacity                                            │
│ uGlowBack           │ uNightOpacity                                          │
│ setRimFront()       │ setDayWidth()                                          │
│ setRimBack()        │ setNightWidth()                                        │
│ setGlowFront()      │ setDayOpacity()                                        │
│ setGlowBack()       │ setNightOpacity()                                      │
└─────────────────────┴────────────────────────────────────────────────────────┘
```

---

## Orbital Debris — Elliptical Keplerian Orbits

Upgraded from circular to full **6-element Keplerian elliptical orbits**, solved
analytically on the GPU each frame via Newton-Raphson iteration on Kepler's equation.

### Orbital mechanics

```
┌──────────────────────┬──────────────────────────────────────────────────────────┐
│ Step                 │ Formula                                                  │
├──────────────────────┼──────────────────────────────────────────────────────────┤
│ Mean motion          │ n = sqrt(GM / a³)                                        │
│ Mean anomaly         │ M = M0 + n·t   (linear in time)                          │
│ Eccentric anomaly    │ M = E − e·sin(E)  → solved by Newton-Raphson (6 iters)   │
│ True anomaly         │ ν = 2·atan(sqrt((1+e)/(1−e)) · tan(E/2))                │
│ Orbital radius       │ r = a·(1 − e·cos(E))                                    │
│ 3-D position         │ r·(perigeeDir·cos(ν) + semilatDir·sin(ν))               │
└──────────────────────┴──────────────────────────────────────────────────────────┘
```

### Orbital element ranges

```
┌────────────────────┬────────────────────────────┬──────────────────────────────┐
│ Element            │ Range                      │ Notes                        │
├────────────────────┼────────────────────────────┼──────────────────────────────┤
│ Eccentricity (e)   │ 0.70 – 0.99               │ Highly elliptical only       │
│ Perigee altitude   │ 200 km – 1,000 km          │ Perigee above surface        │
│ Semi-major axis    │ rPeri / (1 − e)            │ Derived from perigee + e     │
│ Inclination        │ Uniform spherical dist.    │ acos(1 − 2·rand)             │
│ RAAN               │ 0 – 2π  (uniform)          │                              │
│ Arg of perigee     │ 0 – 2π  (uniform)          │                              │
│ Mean anomaly M0    │ 0 – 2π  (uniform)          │ Initial phase                │
└────────────────────┴────────────────────────────┴──────────────────────────────┘
```

### GPU attribute layout

```
┌──────────────┬─────────────────────────────────────────┬────────────┐
│ Attribute    │ Components                              │ itemSize   │
├──────────────┼─────────────────────────────────────────┼────────────┤
│ aOrbit1      │ (a, e, inclination, RAAN)               │ 4          │
│ aOrbit2      │ (argPeri, M0, unused, unused)           │ 4          │
│ aVertRole    │ 0 = head vertex, 1 = tail vertex        │ 1          │
└──────────────┴─────────────────────────────────────────┴────────────┘
```

The streak tail is offset by `uStreakDM = 0.018 rad` in mean anomaly — so the
streak appears **longer near perigee** (faster motion) and **shorter near apogee**
(slower motion), matching real apparent angular velocity.


---

## Orbital Debris — Tail Length Reduction

The curved tail arc has been progressively shortened to keep streaks visually tight:

```
┌──────────────────────────┬────────────────────────────────────────┐
│ Change                   │ TAIL_TOTAL_DM value                    │
├──────────────────────────┼────────────────────────────────────────┤
│ Initial (10 segments)    │ 0.12 rad  (accidentally 10× too long)  │
│ ÷10 correction           │ 0.012 rad                              │
│ ÷5 first reduction       │ 0.0024 rad                             │
│ ÷5 second reduction      │ 0.00048 rad  ← current                 │
└──────────────────────────┴────────────────────────────────────────┘
```

Each of the 10 segments spans `TAIL_TOTAL_DM / 10` of mean anomaly.
The Kepler solver is run independently per vertex so the polyline
follows the true Keplerian arc even at this fine scale.

---

## Debug Overlay — FPS Counter

The top-left debug text overlay (`dragOrbitHandler.ts`) now shows a live
frame-rate counter updated once per second:

```
┌──────────────────────────────────────────────────────────────────┐
│ build  12/25-10:30:00                                            │
│ height 450.23 km                                                 │
│ dist   6821.45 km                                                │
│ fps    60                                                        │
└──────────────────────────────────────────────────────────────────┘
```

Implementation:

```
┌─────────────────┬──────────────────────────────────────────────────┐
│ Field           │ Purpose                                          │
├─────────────────┼──────────────────────────────────────────────────┤
│ _fps            │ Last computed frame rate (integer)               │
│ _fpsFrames      │ Frame accumulator since last fps update          │
│ _fpsLastTime    │ performance.now() timestamp of last fps update   │
└─────────────────┴──────────────────────────────────────────────────┘
```

Updated once per second: `fps = round(frames / elapsedSeconds)`.

---

## Orbital Debris — Eccentricity Range & reinitParticles()

### Eccentricity history

```
┌────────────────────────────┬──────────┬──────────┐
│ Change                     │ ECC_MIN  │ ECC_MAX  │
├────────────────────────────┼──────────┼──────────┤
│ Initial highly-elliptical  │  0.70    │  0.99    │
│ Nearly circular LEO        │  0.00    │  0.10    │
│ Slight spread              │  0.00    │  0.30    │
│ Medium spread              │  0.00    │  0.50    │
│ Current                    │  0.00    │  0.60    │
└────────────────────────────┴──────────┴──────────┘
```

### reinitParticles() method

Particle buffers are now re-uploadable at runtime without destroying the
geometry object. Two helpers were extracted:

```
┌───────────────────────────────┬────────────────────────────────────────┐
│ Method                        │ Purpose                                │
├───────────────────────────────┼────────────────────────────────────────┤
│ static _fillBuffers(...)      │ Fills orbit1, orbit2, role, indices    │
│                               │ Float32Arrays with fresh random        │
│                               │ Keplerian elements                     │
│ reinitParticles()             │ Calls _fillBuffers in-place on the     │
│                               │ existing GPU BufferAttributes, sets    │
│                               │ needsUpdate=true on each, resets       │
│                               │ _simTime to 0                          │
└───────────────────────────────┴────────────────────────────────────────┘
```

ECC_MAX is read at fill-time so any future eccentricity change + a call to
`reinitParticles()` immediately re-seeds all 10,000 particles.
