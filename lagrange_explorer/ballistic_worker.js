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
    
    // Solar perturbations
    const sun_angle = SUN_FREQ_IN_FRAME * t; 
    const sun_x = -SUN_DISTANCE_NORM * Math.cos(sun_angle); 
    const sun_y = -SUN_DISTANCE_NORM * Math.sin(sun_angle); 
    
    const r_sun_sq = (s.x - sun_x)**2 + (s.y - sun_y)**2;
    const r_sun_cubed = Math.pow(r_sun_sq, 1.5);
    
    const r_sun_bary_sq = sun_x**2 + sun_y**2;
    const r_sun_bary_cubed = Math.pow(r_sun_bary_sq, 1.5);
    
    const sun_ax = -MASS_RATIO_SUN * ((s.x - sun_x) / r_sun_cubed + sun_x / r_sun_bary_cubed);
    const sun_ay = -MASS_RATIO_SUN * ((s.y - sun_y) / r_sun_cubed + sun_y / r_sun_bary_cubed);
    
    ax += sun_ax;
    ay += sun_ay;
    
    return { dx: s.vx, dy: s.vy, dvx: ax, dvy: ay };
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
    
    const earth_x = -MASS_RATIO;
    const moon_x = 1 - MASS_RATIO;
    const earth_r_sq = (kmToNorm(EARTH_RADIUS))**2;
    const moon_r_sq = (kmToNorm(MOON_RADIUS))**2;
    
    let collision = null;
    
    while (Math.abs(t) < abs_duration - 1e-9) {
        let step = is_backward ? -abs_dt : abs_dt;
        
        const remaining = abs_duration - Math.abs(t);
        if (remaining < abs_dt) {
            step = is_backward ? -remaining : remaining;
        }
        
        s = rk4Step(s, step, t_start + t);
        t += step;
        
        if (stopOnCollision) {
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

self.onmessage = function(e) {
    const { type, payload } = e.data;
    
    if (type === 'START_SEARCH') {
        const { duration_norm, leo_r_norm } = payload;
        isSearching = true;
        runSearch(duration_norm, leo_r_norm);
    } else if (type === 'STOP_SEARCH') {
        isSearching = false;
    }
};

async function runSearch(duration_norm, leo_r_norm) {
    const earth_x = -MASS_RATIO;
    const leo_tolerance_norm = kmToNorm(500);
    
    let iterations = 0;
    const start_time = Date.now();
    let trajectoriesFound = 0;

    while (isSearching) {
        const batch_size = 20;
        let batchResults = [];
        let debugPaths = [];
        
        for (let i = 0; i < batch_size; i++) {
            // Random Perilune State
            const alt_km = 100 + Math.random() * 9900;
            const theta = Math.random() * 2 * Math.PI;
            const r_p_norm = kmToNorm(MOON_RADIUS + alt_km);
            
            const v_esc = Math.sqrt(2 * MU_MOON / normToKm(r_p_norm)); 
            const v_mag_kms = v_esc * (0.7 + Math.random() * 0.6); 
            
            const v_angle = theta + Math.PI/2 + (Math.random() - 0.5) * 0.2;
            const sun_phase = Math.random() * 2 * Math.PI;
             
             const params = {
                 alt: alt_km,
                 theta: theta,
                 v_mag: v_mag_kms,
                 v_angle_off: v_angle - (theta + Math.PI/2),
                 sun_phase: sun_phase
             };
             
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
             
             if (min_leo_diff < leo_tolerance_norm) {
                 const opt = optimizeCandidate(params, duration_norm, leo_r_norm);
                 
                 const finalParams = opt.params;
                 const finalRes = opt.res;
                 const finalDv = opt.dvs;
                 const { state: finalState, t_arrival_abs: finalTArrival } = getStateFromParams(finalParams);
                 const final_t_intercept = opt.t_intercept;
                 const fwd_path = [...finalRes.path].reverse();
                 
                 let isValidAltitude = true;
                 const min_allowed_r = leo_r_norm - kmToNorm(1.0);
                 
                 for (const p of fwd_path) {
                     const r = Math.sqrt((p.x + MASS_RATIO)**2 + p.y**2);
                     if (r < min_allowed_r) {
                         isValidAltitude = false;
                         break;
                     }
                 }
                 
                 if (isValidAltitude && finalDv.total < 4.0 && normToKm(opt.min_diff) <= 1.0) {
                     const synodic_period = 2 * Math.PI / Math.abs(SUN_FREQ_IN_FRAME);
                     const t_launch_norm = finalTArrival + final_t_intercept;
                     let delay_norm = t_launch_norm % synodic_period;
                     if (delay_norm < 0) delay_norm += synodic_period;
                     
                     const traj = {
                         id: 'traj-' + Math.random().toString(36).substr(2, 9),
                         dv_kms: finalDv.total,
                         dv_earth_kms: finalDv.earth,
                         dv_moon_kms: finalDv.moon,
                         dv_norm: kmsToNorm(finalDv.total),
                         time_days: normToDays(Math.abs(final_t_intercept)),
                         delay_days: normToDays(delay_norm),
                         path: fwd_path,
                         lowResPath: fwd_path,
                         highResComputed: false,
                         min_moon_dist_km: finalParams.alt,
                         lunar_orbit_km: finalParams.alt + MOON_RADIUS, 
                         is_capture: true,
                         initial_sun_angle: (t_launch_norm * SUN_FREQ_IN_FRAME) % (2*Math.PI),
                         orbit_count: (Math.abs(final_t_intercept) / (2*Math.PI)),
                         intercept_dist_km: normToKm(opt.min_diff),
                         arrival_state: finalState,
                         t_arrival_abs: finalTArrival,
                         duration_norm: Math.abs(final_t_intercept),
                         params: finalParams
                     };
                     
                     batchResults.push(traj);
                 }
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
