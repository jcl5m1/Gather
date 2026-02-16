// Physical Constants (Earth-Moon System)
const EARTH_RADIUS = 6371; // km
const MOON_RADIUS = 1737; // km
const EARTH_MOON_DISTANCE = 384400; // km
const EARTH_MASS = 5.972e24; // kg
const MOON_MASS = 7.342e22; // kg
const SUN_MASS = 1.989e30; // kg
const G = 6.67430e-20; // km³/(kg·s²)
const MU_EARTH = 398600.4; // km³/s²
const MU_MOON = 4902.8; // km³/s²
const MU_SYSTEM = MU_EARTH + MU_MOON;
const MASS_RATIO = MOON_MASS / (EARTH_MASS + MOON_MASS); // μ ≈ 0.01215

// Solar perturbation parameters
const EARTH_SUN_DISTANCE = 149597870.7; // km
const SUN_ORBITAL_PERIOD = 365.25 * 24 * 3600; // seconds
const MASS_RATIO_SUN = SUN_MASS / (EARTH_MASS + MOON_MASS); 
const SUN_DISTANCE_NORM = EARTH_SUN_DISTANCE / EARTH_MOON_DISTANCE; 
const SUN_ANGULAR_FREQ = (2 * Math.PI) / (SUN_ORBITAL_PERIOD / (27.32 * 24 * 3600 / (2 * Math.PI))); 
const SUN_FREQ_IN_FRAME = SUN_ANGULAR_FREQ - 1.0; 

// Normalized units
const DIST_UNIT = EARTH_MOON_DISTANCE; 
const TIME_UNIT = 375200; 
const VEL_UNIT = DIST_UNIT / TIME_UNIT; 

// Conversions
const kmToNorm = (km) => km / DIST_UNIT;
const normToKm = (norm) => norm * DIST_UNIT;
const kmsToNorm = (kms) => kms / VEL_UNIT;
const normToKms = (norm) => norm * VEL_UNIT;
const daysToNorm = (days) => (days * 24 * 3600) / TIME_UNIT;
const normToDays = (norm) => (norm * TIME_UNIT) / (24 * 3600);

// ============================================================================
// DYNAMICS
// ============================================================================
function derivatives(s, t = 0) {
    const x1 = -MASS_RATIO;
    const x2 = 1 - MASS_RATIO;
    
    const r1_sq = (s.x - x1)**2 + s.y**2;
    const r2_sq = (s.x - x2)**2 + s.y**2;
    const r1_cubed = Math.pow(r1_sq, 1.5);
    const r2_cubed = Math.pow(r2_sq, 1.5);
    
    let ax = 2*s.vy + s.x - (1-MASS_RATIO)*(s.x - x1)/r1_cubed - MASS_RATIO*(s.x - x2)/r2_cubed;
    let ay = -2*s.vx + s.y - (1-MASS_RATIO)*s.y/r1_cubed - MASS_RATIO*s.y/r2_cubed;
    
    // Solar perturbations (BCR4BP) - DISABLED
    const sun_ax = 0; // -MASS_RATIO_SUN * ((s.x - sun_x) / r_sun_cubed + sun_x / r_sun_bary_cubed);
    const sun_ay = 0; // -MASS_RATIO_SUN * ((s.y - sun_y) / r_sun_cubed + sun_y / r_sun_bary_cubed);
    
    ax += sun_ax;
    ay += sun_ay;
    
    return { dx: s.vx, dy: s.vy, dvx: ax, dvy: ay };
}

function getJacobian(s) {
    const x1 = -MASS_RATIO;
    const x2 = 1 - MASS_RATIO;
    const r1_sq = (s.x - x1)**2 + s.y**2;
    const r2_sq = (s.x - x2)**2 + s.y**2;
    const r1_5 = Math.pow(r1_sq, 2.5);
    const r2_5 = Math.pow(r2_sq, 2.5);
    const r1_3 = Math.pow(r1_sq, 1.5);
    const r2_3 = Math.pow(r2_sq, 1.5);

    const Uxx = 1 - (1-MASS_RATIO)*(1/r1_3 - 3*(s.x-x1)**2/r1_5) - MASS_RATIO*(1/r2_3 - 3*(s.x-x2)**2/r2_5);
    const Uxy = 3*(1-MASS_RATIO)*(s.x-x1)*s.y/r1_5 + 3*MASS_RATIO*(s.x-x2)*s.y/r2_5;
    const Uyy = 1 - (1-MASS_RATIO)*(1/r1_3 - 3*s.y**2/r1_5) - MASS_RATIO*(1/r2_3 - 3*s.y**2/r2_5);

    return { Uxx, Uxy, Uyy };
}

function getEigenDecomposition(l_point_x) {
    const s = { x: l_point_x, y: 0 };
    const J = getJacobian(s);
    
    const b = 4 - J.Uxx - J.Uyy;
    const c = J.Uxx * J.Uyy;
    const disc = b*b - 4*c;
    
    const k1 = (-b + Math.sqrt(disc)) / 2;
    const k2 = (-b - Math.sqrt(disc)) / 2;
    
    const lambda = Math.sqrt(k1); // Real eigenvalue
    const nu = Math.sqrt(-k2);    // Imaginary part (frequency)
    
    const c_stable = (lambda*lambda - J.Uxx) / (2*lambda);
    const v_unstable = [1, c_stable, lambda, c_stable*lambda];
    const v_stable = [1, -c_stable, -lambda, c_stable*lambda];
    
    return { lambda, nu, v_unstable, v_stable, Uxx: J.Uxx, Uyy: J.Uyy, k2 };
}

function computeLyapunov(l_x, amplitude_km) {
    const amp_norm = kmToNorm(amplitude_km);
    const decomp = getEigenDecomposition(l_x);
    const nu = decomp.nu;
    const Uxx = decomp.Uxx;
    
    // Initial State: Start on the LEFT side of the Lagrange point
    // x = L - A
    let x0 = l_x - amp_norm;
    
    // Velocity Guess (Linear Theory)
    // vy > 0 (Up) to create +x Coriolis force (Right) to counteract -x Gravity (Left)
    const vy_guess = 0.5 * (nu*nu + Uxx) * amp_norm; 
    let best_vy = Math.abs(vy_guess); 

    // Differential Correction (Single Shooting)
    for (let iter=0; iter<30; iter++) {
        let s = { x: x0, y: 0, vx: 0, vy: best_vy };
        
        let dt = 0.005;
        let t = 0;
        let crossed = false;
        
        // Duration limit: slightly more than half period
        // Period T = 2*PI/nu. Half T = PI/nu.
        const half_period = Math.PI / nu;
        const limit_t = half_period * 1.5; 
        
        while (t < limit_t) {
            const next = rk4Step(s, dt, t);
            
            // Crossing check (y changes sign)
            if (s.y * next.y < 0 && t > 0.1) { 
                const frac = -s.y / (next.y - s.y);
                // Linear interpolate to exact crossing
                s = {
                    x: s.x + frac * (next.x - s.x),
                    y: 0, 
                    vx: s.vx + frac * (next.vx - s.vx),
                    vy: s.vy + frac * (next.vy - s.vy)
                };
                t += dt * frac;
                crossed = true;
                break;
            }
            
            // Abort if lost
            if (Math.abs(s.y) > 4 * amp_norm || Math.abs(s.x - l_x) > 4 * amp_norm) break; 
            
            // Abort if crashed into moon
            if (l_x > 0.5) {
                const dx_moon = s.x - (1 - MASS_RATIO);
                const r_moon = Math.sqrt(dx_moon*dx_moon + s.y*s.y);
                if (r_moon < kmToNorm(MOON_RADIUS)) break;
            }

            s = next;
            t += dt;
        }
        
        if (!crossed) {
             // Heuristic retry
             if (iter < 5) best_vy *= 1.05; 
             else best_vy *= 0.95;
             continue;
        }
        
        // Target: vx = 0 at crossing.
        if (Math.abs(s.vx) < 1e-9) break; // Converged
        
        // Calculate Jacobian term d(vx_final) / d(vy_initial) numerically
        const d_vy = 1e-6;
        let s_p = { x: x0, y: 0, vx: 0, vy: best_vy + d_vy };
        let t_p = 0;
        let p_crossed = false;
        
        while (t_p < limit_t) {
            const next = rk4Step(s_p, dt, t_p);
            if (s_p.y * next.y < 0 && t_p > 0.1) {
                const frac = -s_p.y / (next.y - s_p.y);
                s_p = {
                    x: s_p.x + frac * (next.x - s_p.x),
                    y: 0,
                    vx: s_p.vx + frac * (next.vx - s_p.vx),
                    vy: s_p.vy + frac * (next.vy - s_p.vy)
                };
                p_crossed = true;
                break;
            }
            if (Math.abs(s_p.y) > 4 * amp_norm) break;
            s_p = next;
            t_p += dt;
        }
        
        if (!p_crossed) {
             best_vy *= 1.01;
             continue;
        }
        
        const grad = (s_p.vx - s.vx) / d_vy;
        
        if (Math.abs(grad) < 1e-12) {
             best_vy += (s.vx > 0 ? -1 : 1) * 0.001; 
        } else {
             const adj = -s.vx / grad;
             const max_step = Math.abs(best_vy) * 0.2; 
             best_vy += Math.max(-max_step, Math.min(max_step, adj));
        }
    }
    
    // Generate full path (simulate for a few periods)
    let final_s = { x: x0, y: 0, vx: 0, vy: best_vy };
    const period_approx = 2 * Math.PI / nu;
    const res = propagate(final_s, period_approx * 1.5, 0.01, 0, 1000, false);
    
    return { path: res.path, period: period_approx, vy0: best_vy };
}

function getPotential(x, y, z=0) {
    const x1 = -MASS_RATIO;
    const x2 = 1 - MASS_RATIO;
    const r1 = Math.sqrt((x-x1)**2 + y**2 + z**2);
    const r2 = Math.sqrt((x-x2)**2 + y**2 + z**2);
    return 0.5*(x**2 + y**2) + (1-MASS_RATIO)/r1 + MASS_RATIO/r2;
}

function solveLagrangePoints() {
    const f = (x) => {
        const x1 = -MASS_RATIO;
        const x2 = 1 - MASS_RATIO;
        const r1 = Math.abs(x - x1);
        const r2 = Math.abs(x - x2);
        const term1 = (1-MASS_RATIO) * (x - x1) / (r1*r1*r1);
        const term2 = MASS_RATIO * (x - x2) / (r2*r2*r2);
        return x - term1 - term2;
    };
    
    // L1: between Earth and Moon
    let l1 = 1 - MASS_RATIO - Math.pow(MASS_RATIO/3, 1/3); 
    for(let i=0; i<20; i++) {
        const val = f(l1);
        // Approximate derivative
        const df = (f(l1+1e-6) - f(l1-1e-6)) / 2e-6; 
        l1 -= val/df;
    }
    
    // L2: beyond Moon
    let l2 = 1 - MASS_RATIO + Math.pow(MASS_RATIO/3, 1/3);
    for(let i=0; i<20; i++) {
        const val = f(l2);
        const df = (f(l2+1e-6) - f(l2-1e-6)) / 2e-6; 
        l2 -= val/df;
    }
    
    return { l1, l2 };
}

function rk4Step(s, dt, t_current) {
    const k1 = derivatives(s, t_current);
    const s2 = { 
        x: s.x + k1.dx*dt/2, 
        y: s.y + k1.dy*dt/2, 
        vx: s.vx + k1.dvx*dt/2, 
        vy: s.vy + k1.dvy*dt/2 
    };
    const k2 = derivatives(s2, t_current + dt/2);
    const s3 = { 
        x: s.x + k2.dx*dt/2, 
        y: s.y + k2.dy*dt/2, 
        vx: s.vx + k2.dvx*dt/2, 
        vy: s.vy + k2.dvy*dt/2 
    };
    const k3 = derivatives(s3, t_current + dt/2);
    const s4 = { 
        x: s.x + k3.dx*dt, 
        y: s.y + k3.dy*dt, 
        vx: s.vx + k3.dvx*dt, 
        vy: s.vy + k3.dvy*dt 
    };
    const k4 = derivatives(s4, t_current + dt);
    
    return {
        x: s.x + (dt/6)*(k1.dx + 2*k2.dx + 2*k3.dx + k4.dx),
        y: s.y + (dt/6)*(k1.dy + 2*k2.dy + 2*k3.dy + k4.dy),
        vx: s.vx + (dt/6)*(k1.dvx + 2*k2.dvx + 2*k3.dvx + k4.dvx),
        vy: s.vy + (dt/6)*(k1.dvy + 2*k2.dvy + 2*k3.dvy + k4.dvy)
    };
}

function propagate(state, duration, dt = 0.001, t_start = 0, max_steps = 2000, stopOnCollision = true) {
    let s = { ...state };
    let path = [{ x: s.x, y: s.y }];
    let t = 0;
    const is_backward = dt < 0;
    const abs_duration = Math.abs(duration);
    const abs_dt = Math.abs(dt);
    
    // Collision thresholds (squared)
    const earth_x = -MASS_RATIO;
    const moon_x = 1 - MASS_RATIO;
    const earth_r_sq = (kmToNorm(EARTH_RADIUS))**2;
    const moon_r_sq = (kmToNorm(MOON_RADIUS))**2;
    
    let collision = null;
    
    // Use a small tolerance to avoid floating point issues with the loop condition
    while (Math.abs(t) < abs_duration - 1e-9) {
        let step = is_backward ? -abs_dt : abs_dt;
        
        // Handle last step
        const remaining = abs_duration - Math.abs(t);
        if (remaining < abs_dt) {
            step = is_backward ? -remaining : remaining;
        }
        
        s = rk4Step(s, step, t_start + t);
        t += step;
        
        if (stopOnCollision) {
            // Check collisions
            const r1_sq = (s.x - earth_x)**2 + s.y**2;
            if (r1_sq < earth_r_sq) {
                collision = 'earth';
                break;
            }
            
            const r2_sq = (s.x - moon_x)**2 + s.y**2;
            if (r2_sq < moon_r_sq) {
                collision = 'moon';
                break;
            }
        }
        
        if (path.length < max_steps || Math.abs(t) >= abs_duration - 1e-9) {
            path.push({ x: s.x, y: s.y });
        }
    }
    return { state: s, path, collision };
}

function getStateFromParams(p) {
    const r_p_norm = kmToNorm(MOON_RADIUS + p.alt);
    const moon_x = 1 - MASS_RATIO;
    const dx = r_p_norm * Math.cos(p.theta);
    const dy = r_p_norm * Math.sin(p.theta);
    const pos = { x: moon_x + dx, y: dy };
    
    const v_mag_norm = kmsToNorm(p.v_mag);
    const v_angle = p.theta + Math.PI/2 + p.v_angle_off;
    
    const vx_in = v_mag_norm * Math.cos(v_angle);
    const vy_in = v_mag_norm * Math.sin(v_angle);
    
    const vx = vx_in + pos.y;
    const vy = vy_in - pos.x;
    
    const t_arrival_abs = p.sun_phase / Math.abs(SUN_FREQ_IN_FRAME);
    
    return { state: { x: pos.x, y: pos.y, vx, vy }, t_arrival_abs };
}

function calculateDeltas(state, t_intercept, t_arrival, leo_r_norm, state_moon_params) {
    const dt = -0.0004;
    const steps = Math.abs(t_intercept / dt);
    let s_leo = state;
    for(let i=0; i<steps; i++) s_leo = rk4Step(s_leo, dt, t_arrival + i*dt);
    
    const earth_x = -MASS_RATIO;
    const dx = s_leo.x - earth_x;
    const dy = s_leo.y;
    const r_sat = Math.sqrt(dx*dx + dy*dy);
    
    const v_circ_mag = Math.sqrt(MU_EARTH / normToKm(r_sat));
    const vx_in = s_leo.vx - s_leo.y;
    const vy_in = s_leo.vy + s_leo.x;
    
    const angle = Math.atan2(dy, dx);
    const vx_circ = -v_circ_mag * Math.sin(angle);
    const vy_circ = v_circ_mag * Math.cos(angle);
    
    const dv_earth = Math.sqrt((vx_in - vx_circ)**2 + (vy_in - vy_circ)**2);
    
    // Moon Delta-V
    const v_sat_bx = state.vx - state.y; 
    const v_sat_by = state.vy + state.x;
    const p_moon_x = 1 - MASS_RATIO;
    
    // Moon velocity (Inertial)
    const v_moon_bx = 0; 
    const v_moon_by = p_moon_x; 
    
    const v_rel_x = v_sat_bx - v_moon_bx;
    const v_rel_y = v_sat_by - v_moon_by;
    const v_rel_mag = Math.sqrt(v_rel_x*v_rel_x + v_rel_y*v_rel_y);
    const v_rel_kms = normToKms(v_rel_mag);
    
    const r_moon = Math.sqrt((state.x - p_moon_x)**2 + state.y**2);
    const v_circ_moon = Math.sqrt(MU_MOON / normToKm(r_moon));
    
    const dv_moon = Math.abs(v_rel_kms - v_circ_moon);
    
    return { earth: dv_earth, moon: dv_moon, total: dv_earth + dv_moon, r_error: Math.abs(r_sat - leo_r_norm) };
}

function optimizeCandidate(startParams, duration, leo_r) {
    let currentParams = { ...startParams };
    let bestParams = { ...startParams };
    
    const s0 = getStateFromParams(currentParams);
    
    const highResDt = -0.002;
    const maxSteps = Math.ceil(duration / Math.abs(highResDt)) + 1000;
    const res0 = propagate(s0.state, duration, highResDt, s0.t_arrival_abs, maxSteps, false);
    
    let minDiff = Infinity;
    let bIdx = -1;
    const ex = -MASS_RATIO;
    for(let i=0; i<res0.path.length; i++) {
        const p = res0.path[i];
        const d = Math.abs(Math.sqrt((p.x - ex)**2 + p.y**2) - leo_r);
        if(d < minDiff) { minDiff = d; bIdx = i; }
    }
    
    let t_int = bIdx * highResDt;
    let metrics = calculateDeltas(s0.state, t_int, s0.t_arrival_abs, leo_r, currentParams);
    let bestCost = metrics.total + normToKm(minDiff) * 0.1; 
    let bestRes = res0;
    let bestDVs = metrics;
    let bestTint = t_int;
    let bestMinDiff = minDiff;

    const steps = [
        { k: 'alt', d: 20.0 },
        { k: 'theta', d: 0.05 },
        { k: 'v_mag', d: 0.01 },
        { k: 'v_angle_off', d: 0.01 },
        { k: 'sun_phase', d: 0.1 }
    ];
    
    for(let iter=0; iter<15; iter++) {
        let improved = false;
        
        for(let s of steps) {
            let pTest = { ...currentParams };
            pTest[s.k] += s.d;
            
            const st = getStateFromParams(pTest);
            const r = propagate(st.state, duration, highResDt, st.t_arrival_abs, maxSteps, false);
            
            let md = Infinity;
            let bi = -1;
            for(let i=0; i<r.path.length; i++) {
                const p = r.path[i];
                const d = Math.abs(Math.sqrt((p.x - ex)**2 + p.y**2) - leo_r);
                if(d < md) { md = d; bi = i; }
            }
            
            const ti = bi * highResDt;
            const m = calculateDeltas(st.state, ti, st.t_arrival_abs, leo_r, pTest);
            
            if (md > leo_r * 0.5) m.total += 1000; 
            
            const cost = m.total + normToKm(md) * 0.5; 
            
            if (cost < bestCost) {
                bestCost = cost;
                bestParams = pTest;
                currentParams = pTest;
                bestRes = r;
                bestDVs = m;
                bestTint = ti;
                bestMinDiff = md;
                improved = true;
                continue;
            }
            
            pTest[s.k] -= 2 * s.d; 
             const st2 = getStateFromParams(pTest);
            const r2 = propagate(st2.state, duration, highResDt, st2.t_arrival_abs, maxSteps, false);
            
            let md2 = Infinity;
            let bi2 = -1;
            for(let i=0; i<r2.path.length; i++) {
                const p = r2.path[i];
                const d = Math.abs(Math.sqrt((p.x - ex)**2 + p.y**2) - leo_r);
                if(d < md2) { md2 = d; bi2 = i; }
            }
            
            const ti2 = bi2 * highResDt;
            const m2 = calculateDeltas(st2.state, ti2, st2.t_arrival_abs, leo_r, pTest);
            if (md2 > leo_r * 0.5) m2.total += 1000;
            
            const cost2 = m2.total + normToKm(md2) * 0.5;
            
            if (cost2 < bestCost) {
                bestCost = cost2;
                bestParams = pTest;
                currentParams = pTest;
                bestRes = r2;
                bestDVs = m2;
                bestTint = ti2;
                bestMinDiff = md2;
                improved = true;
            }
        }
        
        if (!improved) break; 
        steps.forEach(s => s.d *= 0.6);
    }
    
    const trimIdx = Math.round(Math.abs(bestTint / highResDt));
    const trimmedPath = bestRes.path.slice(0, trimIdx+1);
    
    return {
        params: bestParams,
        dvs: bestDVs,
        res: { ...bestRes, path: trimmedPath },
        t_intercept: bestTint,
        min_diff: bestMinDiff
    };
}

// ============================================================================
// WORKER MESSAGE HANDLING
// ============================================================================

let isSearching = false;
let manifoldSeeds = []; // Seeds for the search algorithm

self.onmessage = function(e) {
    const { type, payload } = e.data;
    
    if (type === 'START_SEARCH') {
        const { duration_norm, leo_r_norm } = payload;
        isSearching = true;
        // Ensure manifolds are ready if not already
        if (manifoldSeeds.length === 0) {
             generateManifolds(daysToNorm(90));
        }
        runSearch(duration_norm, leo_r_norm);
    } else if (type === 'STOP_SEARCH') {
        isSearching = false;
    } else if (type === 'GENERATE_MANIFOLDS') {
        const { duration_norm } = payload || { duration_norm: daysToNorm(60) };
        generateManifolds(duration_norm);
    } else if (type === 'COMPUTE_SYSTEM_INFO') {
        const { l1, l2 } = solveLagrangePoints();
        const l1_decomp = getEigenDecomposition(l1);
        const l2_decomp = getEigenDecomposition(l2);
        
        // Compute Orbits
        // ~3500 km amplitude
        const l1_orbit = computeLyapunov(l1, 3500);
        const l2_orbit = computeLyapunov(l2, 3500);
        
        postMessage({
            type: 'SYSTEM_INFO',
            payload: {
                l1: { x: l1, decomp: l1_decomp, orbit: l1_orbit },
                l2: { x: l2, decomp: l2_decomp, orbit: l2_orbit }
            }
        });
    }
};

function generateManifolds(duration) {
    const { l1, l2 } = solveLagrangePoints();
    const points = [
        { x: l1, label: 'L1', dir: 1 }, // dir 1 = towards moon (approx)
        { x: l2, label: 'L2', dir: -1 } 
    ];
    
    const manifolds = [];
    manifoldSeeds = []; // Reset seeds
    
    const offset = kmToNorm(500); // 500km offset to get things moving
    const vel_kick = kmsToNorm(0.01); // Tiny velocity kick

    // We want to generate a dense set of seeds for the search
    const branches = 50; 
    
    points.forEach(pt => {
        // Generate Unstable Manifolds (Forward) -> Into the system
        for (let i = 0; i < branches; i++) {
            const angle = (Math.random() - 0.5) * Math.PI; // Cone towards/away
            // Bias x direction towards moon
            const dx = Math.cos(angle) * pt.dir; 
            const dy = Math.sin(angle);
            
            const startState = {
                x: pt.x + dx * offset,
                y: dy * offset,
                vx: dx * vel_kick, // Small push 
                vy: dy * vel_kick
            };

            // Propagate Forward (Unstable)
            const fwd = propagate(startState, duration, 0.002, 0, 2000, false);
            if (fwd.path.length > 5) {
                manifolds.push(fwd.path);
                
                // Analyze for Perilune (Closest Approach to Moon)
                const moon_x = 1 - MASS_RATIO;
                let min_dist = Infinity;
                let best_state = null;
                let best_t = 0;
                
                for (let j=0; j<fwd.path.length; j++) {
                     const p = fwd.path[j];
                     const dist = Math.sqrt((p.x - moon_x)**2 + p.y**2);
                     if (dist < min_dist) {
                         min_dist = dist;
                         best_state = { x: p.x, y: p.y, vx: fwd.path[j].vx || 0, vy: fwd.path[j].vy || 0 }; // path needs vx/vy? propagate returns it in state but path only has xy usually?
                         // Wait, propagate stores {x,y} in path. It does NOT store vx/vy in path array.
                         // We need to re-propagate or store it. 
                         // Let's modify propagate to return full state? Too expensive for drawing.
                         // We can estimate velocity or just store index.
                         best_t = j * 0.002;
                     }
                }
                
                // If it got reasonably close to Moon (e.g. < 20000km)
                if (min_dist < kmToNorm(20000)) {
                    // We need the full state at this point.
                    // Fast-forward to this time to get velocity
                    const fullState = propagate(startState, best_t, 0.002, 0, Math.ceil(best_t/0.002)+2, false).state;
                    
                    // Convert to Params
                    // 1. Position -> Alt, Theta
                    const r_vec_x = fullState.x - moon_x;
                    const r_vec_y = fullState.y;
                    const r_mag = Math.sqrt(r_vec_x**2 + r_vec_y**2);
                    const alt_km = normToKm(r_mag) - MOON_RADIUS;
                    const theta = Math.atan2(r_vec_y, r_vec_x);
                    
                    // 2. Velocity -> v_mag, v_angle_off
                    // Convert Rotating Vel (vx, vy) to Inertial Vel (vx_in, vy_in)
                    const vx_in = fullState.vx - fullState.y;
                    const vy_in = fullState.vy + fullState.x;
                    const v_mag_norm = Math.sqrt(vx_in**2 + vy_in**2);
                    const v_mag_kms = normToKms(v_mag_norm);
                    const v_angle_in = Math.atan2(vy_in, vx_in);
                    
                    // v_angle = theta + PI/2 + off
                    // off = v_angle - (theta + PI/2)
                    let angle_off = v_angle_in - (theta + Math.PI/2);
                    // Normalize to -PI..PI
                    while (angle_off > Math.PI) angle_off -= 2*Math.PI;
                    while (angle_off < -Math.PI) angle_off += 2*Math.PI;
                    
                    // 3. Time -> Sun Phase
                    // t is the time since start.
                    // We assume start was at t=0 (sun_angle=0).
                    // So sun_angle at intercept = best_t * SUN_FREQ
                    const sun_phase = (best_t * SUN_FREQ_IN_FRAME) % (2*Math.PI);
                    
                    // 4. Jacobi Constant
                    // C = 2*U - v^2
                    const pot = getPotential(fullState.x, fullState.y);
                    const v_rot_sq = fullState.vx**2 + fullState.vy**2;
                    const C = 2*pot - v_rot_sq;

                    manifoldSeeds.push({
                        alt: alt_km,
                        theta: theta,
                        v_mag: v_mag_kms,
                        v_angle_off: angle_off,
                        sun_phase: sun_phase,
                        C: C
                    });
                }
            }
        }
    });

    postMessage({
        type: 'MANIFOLDS_GENERATED',
        payload: manifolds
    });
}



async function runSearch(duration_norm, leo_r_norm) {
    const earth_x = -MASS_RATIO;
    const leo_tolerance_norm = kmToNorm(500);
    
    // Calculate Jacobi just for reference limits
    const { l1 } = solveLagrangePoints();
    const C_L1 = 2 * getPotential(l1, 0);
    
    let iterations = 0;
    const start_time = Date.now();
    let trajectoriesFound = 0;

    while (isSearching) {
        const batch_size = 20;
        let batchResults = [];
        let debugPaths = [];
        let bestBatchDiff = Infinity;
        let bestBatchCandidate = null;
        
        for (let i = 0; i < batch_size; i++) {
            let params;
            
            // USE MANIFOLD SEEDS (80% chance)
            if (manifoldSeeds.length > 0 && Math.random() < 0.8) {
                const seed = manifoldSeeds[Math.floor(Math.random() * manifoldSeeds.length)];
                
                // Mutable copy with PERTURBATION
                // We must perturb them because the manifolds themselves don't necessarily hit Earth LEO,
                // they just map the flow from L1/L2 to the Moon.
                params = {
                    alt: seed.alt + (Math.random() - 0.5) * 200, // +/- 100km
                    theta: seed.theta + (Math.random() - 0.5) * 0.2, // +/- 0.1 rad
                    v_mag: seed.v_mag + (Math.random() - 0.5) * 0.05, // +/- 0.025 km/s
                    v_angle_off: seed.v_angle_off + (Math.random() - 0.5) * 0.05,
                    sun_phase: seed.sun_phase + (Math.random() - 0.5) * 0.5,
                    C: seed.C // derived, but we track it
                };
            } else {
                // FALLBACK: Pure Random (Old Logic)
                // ... (Keep existing random logic roughly)
                const alt_km = 100 + Math.random() * 9900;
                const theta = Math.random() * 2 * Math.PI;
                const r_p_norm = kmToNorm(MOON_RADIUS + alt_km);
                const moon_x = 1 - MASS_RATIO;
                const pos_x = moon_x + r_p_norm * Math.cos(theta);
                const pos_y = r_p_norm * Math.sin(theta);
                const omega = getPotential(pos_x, pos_y);
                const target_C = 2.95 + Math.random() * (C_L1 - 2.95);
                const v_sq = 2 * omega - target_C;
                if (v_sq < 0) continue;
                const v_mag = Math.sqrt(v_sq);
                const v_mag_kms = normToKms(v_mag);
                const v_angle = theta + Math.PI/2 + (Math.random() - 0.5) * 2.0; 
                const sun_phase = Math.random() * 2 * Math.PI;
                
                params = {
                    alt: alt_km,
                    theta: theta,
                    v_mag: v_mag_kms,
                    v_angle_off: v_angle - (theta + Math.PI/2),
                    sun_phase: sun_phase,
                    C: target_C
                };
            }
             
             const { state, t_arrival_abs } = getStateFromParams(params);
             
             // Propagate BACKWARD
             const maxSteps = Math.ceil(duration_norm / 0.002) + 1000;
             const result = propagate(state, duration_norm, -0.002, t_arrival_abs, maxSteps, false);
             
             // Always send a few paths for visualization (e.g., first 5 of batch)
             if (i < 5) {
                 debugPaths.push(result.path);
             }
             
            // Check LEO Intercept
             let best_leo_idx = -1;
             let min_leo_diff = Infinity;
             
             for (let j = 0; j < result.path.length; j++) {
                 const p = result.path[j];
                 const r_earth = Math.sqrt((p.x - earth_x)**2 + p.y**2);
                 const diff = Math.abs(r_earth - leo_r_norm);
                 
                 if (diff < min_leo_diff) {
                     min_leo_diff = diff;
                     best_leo_idx = j;
                 }
             }
             
             // Track Best In Batch
             if (min_leo_diff < bestBatchDiff) {
                 bestBatchDiff = min_leo_diff;
                 bestBatchCandidate = params;
             }
        }
        
        // Optimize the Single Best Candidate from this Batch
        if (bestBatchCandidate) {
            const opt = optimizeCandidate(bestBatchCandidate, duration_norm, leo_r_norm);
            
            const finalParams = opt.params;
            const finalRes = opt.res;
            const { state: finalState, t_arrival_abs: finalTArrival } = getStateFromParams(finalParams);
            
            // REFINE INTERCEPT (High Precision)
            const refine_dt = -0.0004; // 5x higher resolution (0.002 / 5)
            const fwd_path = [...finalRes.path].reverse();
            
            const s_exact = getStateFromParams(finalParams);
            const denseRes = propagate(s_exact.state, duration_norm, refine_dt, s_exact.t_arrival_abs, 50000, false);
            
            let best_idx = -1;
            let min_diff = Infinity;
            
            for(let k=0; k<denseRes.path.length; k++) {
                const p = denseRes.path[k];
                const d = Math.abs(Math.sqrt((p.x - earth_x)**2 + p.y**2) - leo_r_norm);
                if(d < min_diff) { min_diff = d; best_idx = k; }
            }
            
            const t_best_intercept = best_idx * refine_dt;
            const metrics = calculateDeltas(s_exact.state, t_best_intercept, s_exact.t_arrival_abs, leo_r_norm, finalParams);
            
            // Validate Results
            let isValidAltitude = true;
            const min_allowed_r = leo_r_norm - kmToNorm(1.0);
            const refined_path_rev = [...denseRes.path.slice(0, best_idx+1)].reverse();
            
            for (const p of refined_path_rev) {
                const r = Math.sqrt((p.x + MASS_RATIO)**2 + p.y**2);
                if (r < min_allowed_r) {
                    isValidAltitude = false;
                    break;
                }
            }

            if (isValidAltitude && metrics.total < 4.0 && normToKm(min_diff) <= 1.0) {
                 const synodic_period = 2 * Math.PI / Math.abs(SUN_FREQ_IN_FRAME);
                 const t_launch_norm = finalTArrival + t_best_intercept;
                 let delay_norm = t_launch_norm % synodic_period;
                 if (delay_norm < 0) delay_norm += synodic_period;
                 
                 const traj = {
                     id: 'traj-' + Math.random().toString(36).substr(2, 9),
                     delta_v: {
                         total: metrics.total,
                         earth: metrics.earth,
                         moon: metrics.moon
                     },
                     time_days: normToDays(Math.abs(t_best_intercept)),
                     delay_days: normToDays(delay_norm),
                     path: refined_path_rev,
                     lowResPath: fwd_path,
                     highResComputed: false,
                     min_moon_dist_km: finalParams.alt,
                     lunar_orbit_km: finalParams.alt + MOON_RADIUS, 
                     is_capture: true,
                     initial_sun_angle: (t_launch_norm * SUN_FREQ_IN_FRAME) % (2*Math.PI),
                     orbit_count: (Math.abs(t_best_intercept) / (2*Math.PI)),
                     intercept_dist_km: normToKm(min_diff),
                     arrival_state: finalState,
                     t_arrival_abs: finalTArrival,
                     duration_norm: Math.abs(t_best_intercept),
                     params: finalParams
                 };
                
                batchResults.push(traj);
            }
        }
        
        iterations++;
        trajectoriesFound += batchResults.length;
        
        postMessage({ 
            type: 'PROGRESS', 
            payload: { 
                iterations: iterations * batch_size,
                trajectories: batchResults,
                debugPaths: debugPaths
            } 
        });
        
        // Removed limits: run until stopped by user

        // Small yield to allow message processing event if worker is single threaded
        await new Promise(r => setTimeout(r, 0));
    }
}
