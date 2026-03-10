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
    console.log(`Computing Lyapunov orbit at ${l_x.toFixed(5)} with amplitude ${amplitude_km} km`);
    const decomp = getEigenDecomposition(l_x);
    const nu = decomp.nu;
    const Uxx = decomp.Uxx;
    
    // Internal Helper: Single Shooting Solver
    // Internal Helper: Single Shooting Solver
    const solveForAmp = (target_amp_norm, guess_vy) => {
        let best_vy = Math.abs(guess_vy);
        const x0 = l_x - target_amp_norm;
        
        let final_s = null;
        let final_period = 0;
        let converged = false;

        // Single Shooting Loop
        for (let iter=0; iter<100; iter++) { // Increased iterations
            let s = { x: x0, y: 0, vx: 0, vy: best_vy };
            
            // Smaller time step for better precision at large amplitudes
            let dt = 0.001; 
            let t = 0;
            let crossed = false;
            
            // Allow for significant period variation
            const limit_t = (Math.PI / nu) * 8.0;
            
            while (t < limit_t) {
                const next = rk4Step(s, dt, t);
                
                // Crossing check (y changes sign)
                if (s.y * next.y < 0 && t > 0.1) { 
                    const frac = -s.y / (next.y - s.y);
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
                
                // Escape checks
                const dist = Math.abs(s.x - l_x);
                // Relaxed bound: 0.5 (halfway to Earth approx) or much larger
                const max_dist = 0.5; 
                if (dist > max_dist || Math.abs(s.y) > max_dist) break;
                
                // Crash into Moon check
                const dx_moon = s.x - (1 - MASS_RATIO);
                if (Math.sqrt(dx_moon*dx_moon + s.y*s.y) < kmToNorm(MOON_RADIUS)) break;

                s = next;
                t += dt;
            }
            
            if (!crossed) {
                 // Severe failure to cross y=0 inside bounds/time
                 if (iter < 40) best_vy *= 1.02; // Gentler search
                 else best_vy *= 0.98;
                 continue;
            }
            
            final_s = s;
            final_period = 2 * t;

            // Convergence check
            if (Math.abs(s.vx) < 1e-10) {
                converged = true;
                break;
            }
            
            // Newton Step
            const d_vy = 1e-7;
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
                const dist = Math.abs(s_p.x - l_x);
                 const max_dist = 0.5; 
                if (dist > max_dist || Math.abs(s_p.y) > max_dist) break;
                s_p = next;
                t_p += dt;
            }
            
            if (!p_crossed) {
                 best_vy *= 1.001; 
                 continue;
            }
            
            const grad = (s_p.vx - s.vx) / d_vy;
            
            if (Math.abs(grad) < 1e-12) {
                 best_vy += (s.vx > 0 ? -1 : 1) * 0.0001; 
            } else {
                 const adj = -s.vx / grad;
                 // Damped Newton
                 let step = adj;
                 const max_change = best_vy * 0.05; // Restricted change to 5%
                 if (Math.abs(step) > max_change) step = max_change * Math.sign(step);
                 best_vy += step;
            }
        }
        return { vy: best_vy, period: final_period, converged: converged };
    };

    // ADAPTIVE STEP-SIZE CONTINUATION STRATEGY
    // We maintain a history of successful solves (amp, vy)
    // We extrapolate the next guess from the last 2 points.
    // If a step fails, we halve the step size and retry.
    
    // History: { a: dist_km, v: vy }
    
    let history = [];
    
    // Bootstrap with very small amplitude (Linear Theory is accurate here)
    const seed_amp_km = 100;
    const seed_amp_norm = kmToNorm(seed_amp_km);
    const seed_vy = 0.5 * (nu*nu + Uxx) * seed_amp_norm;
    
    // Solve seed
    const seed_res = solveForAmp(seed_amp_norm, seed_vy);
    
    // Always add seed 
    history.push({ a: seed_amp_km, v: seed_res.vy });
    
    let current_amp_km = seed_amp_km;
    let step_size_km = 500; // Start with bigger steps and adapt down
    
    while (current_amp_km < amplitude_km) {
        // If we are close to target, just step to target
        if (current_amp_km + step_size_km > amplitude_km) {
            step_size_km = amplitude_km - current_amp_km;
        }
        
        const next_amp_km = current_amp_km + step_size_km;
        const next_amp_norm = kmToNorm(next_amp_km);
        
        // Extrapolate Guess
        let guess_vy;
        const n = history.length;
        if (n >= 2) {
            const last = history[n-1];
            const prev = history[n-2];
            const slope = (last.v - prev.v) / (last.a - prev.a);
            guess_vy = last.v + slope * (next_amp_km - last.a);
        } else {
            // Linear through zero
            const last = history[n-1];
            guess_vy = last.v * (next_amp_km / last.a);
        }
        
        const res = solveForAmp(next_amp_norm, guess_vy);
        
        if (res.converged) {
            // Success: Advance
            history.push({ a: next_amp_km, v: res.vy });
            current_amp_km = next_amp_km;
            
            // Heuristic to increase step size if things are going smoothing
            if (step_size_km < 1000 && n > 5) step_size_km *= 1.2;
            if (step_size_km > 1000) step_size_km = 1000;
        } else {
            // Failure: Reduce Step Size
            step_size_km *= 0.5;
            
            // Check for minimum step
            if (step_size_km < 10) {
                console.warn(`Failed to converge at ${next_amp_km}km even with small steps. Stopping continuation.`);
                break; // Give up
            }
        }
    }
    
    // Final result is the last entry in history
    let final_res = history[history.length - 1];
    
    let final_vy = final_res.v;
    let effective_amp_km = final_res.a;
    
    // If we didn't reach target, try ONE LAST HAIL MARY at the full target 
    // using the best extrapolation we have. 
    if (Math.abs(effective_amp_km - amplitude_km) > 1.0) {
         let guess_vy;
         const n = history.length;
         if (n >= 2) {
            const last = history[n-1];
            const prev = history[n-2];
            const slope = (last.v - prev.v) / (last.a - prev.a);
            guess_vy = last.v + slope * (amplitude_km - last.a);
         } else {
             guess_vy = final_res.v * (amplitude_km / final_res.a);
         }
         const res = solveForAmp(kmToNorm(amplitude_km), guess_vy);
         
         // Even if not converged, use it if it's better than nothing
         if (res.converged || (res.period > 0 && Math.abs(res.vy) > 0)) {
             final_vy = res.vy;
             effective_amp_km = amplitude_km;
         }
    }
    
    const x0 = l_x - kmToNorm(effective_amp_km);
    const period_approx = (2 * Math.PI / nu) * 1.5;
    
    const res = propagate({ x: x0, y: 0, vx: 0, vy: final_vy }, period_approx * 1.05, 0.01, 0, 1000, false);
    
    return { path: res.path, period: period_approx, vy0: final_vy, amplitude_km: amplitude_km };
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

    // L3: Opposite side of Earth
    let l3 = -(1 + 5/12 * MASS_RATIO);
    for(let i=0; i<20; i++) {
        const val = f(l3);
        const df = (f(l3+1e-6) - f(l3-1e-6)) / 2e-6; 
        l3 -= val/df;
    }

    // L4 and L5 (Analytical)
    const l4 = { x: 0.5 - MASS_RATIO, y: Math.sqrt(3)/2 };
    const l5 = { x: 0.5 - MASS_RATIO, y: -Math.sqrt(3)/2 };
    
    return { l1, l2, l3, l4, l5 };
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

function propagate(state, duration, dt = 0.001, t_start = 0, max_steps = 2000, stopOnCollision = true, customStop = null) {
    let s = { ...state };
    let path = [{ x: s.x, y: s.y, vx: s.vx, vy: s.vy }];
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
        
        const prev_s = s;
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
        
        if (customStop && customStop(s, prev_s)) {
            path.push({ x: s.x, y: s.y, vx: s.vx, vy: s.vy });
            break;
        }
        
        if (path.length < max_steps || Math.abs(t) >= abs_duration - 1e-9) {
            path.push({ x: s.x, y: s.y, vx: s.vx, vy: s.vy });
        }
    }
    return { state: s, path, collision };
}





// ============================================================================
// DIFFERENTIAL CORRECTION
// ============================================================================
let latestSearchId = -1;

async function findGeneralPeriodicOrbit(guess_state, num_crossings = 1, dry_run = false, progressCallback = null, searchId = -1) {
    let u = [guess_state.x, guess_state.vx, guess_state.vy];
    const y_sec = guess_state.y;
    let sign_vy = Math.sign(guess_state.vy) || 1;
    
    // Check if motion is primarily in x direction, then use x section.
    let use_y_sec = Math.abs(guess_state.vy) > Math.abs(guess_state.vx);
    let sec_val = use_y_sec ? guess_state.y : guess_state.x;
    if (!use_y_sec) {
        u = [guess_state.y, guess_state.vx, guess_state.vy];
        sign_vy = Math.sign(guess_state.vx) || 1;
    }
    
    const max_t = 50.0; // Extended time to allow for up to 8 crossings

    const evaluateRun = (uv) => {
        let s = {
            x: use_y_sec ? uv[0] : sec_val,
            y: use_y_sec ? sec_val : uv[0],
            vx: uv[1],
            vy: uv[2]
        };
        let t = 0;
        let dt = 0.005;
        let crossed_count = 0;
        let return_state = null;
        let return_t = 0;
        let crossings = [];
        
        let escapeReason = `Max integration time reached (${max_t} TU)`;
        while (t < max_t) {
            let next = rk4Step(s, dt, t);
            let crossed_sec = false;
            let frac = 0;
            if (use_y_sec) {
                if (Math.sign(s.y - sec_val) !== Math.sign(next.y - sec_val) && next.vy * sign_vy > 0 && t > 0.2) {
                    frac = (sec_val - s.y) / (next.y - s.y);
                    crossed_sec = true;
                }
            } else {
                if (Math.sign(s.x - sec_val) !== Math.sign(next.x - sec_val) && next.vx * sign_vy > 0 && t > 0.2) {
                    frac = (sec_val - s.x) / (next.x - s.x);
                    crossed_sec = true;
                }
            }
            if (crossed_sec) {
                const intersect_state = {
                    x: s.x + frac * (next.x - s.x),
                    y: s.y + frac * (next.y - s.y),
                    vx: s.vx + frac * (next.vx - s.vx),
                    vy: s.vy + frac * (next.vy - s.vy)
                };
                crossings.push(intersect_state);
                crossed_count++;
                if (crossed_count === num_crossings) {
                    return_state = intersect_state;
                    return_t = t + dt * frac;
                    break;
                }
            }
            // escapes
            if (Math.abs(next.x) > 2 || Math.abs(next.y) > 2) {
                const exceeded = Math.abs(next.x) > 2 ? `|x|=${Math.abs(next.x).toFixed(2)}` : `|y|=${Math.abs(next.y).toFixed(2)}`;
                escapeReason = `Escaped system bounds (>2), ${exceeded}`;
                break;
            }
            const dE = Math.sqrt((next.x + MASS_RATIO)**2 + next.y**2);
            const dM = Math.sqrt((next.x - (1-MASS_RATIO))**2 + next.y**2);
            if (dE < kmToNorm(EARTH_RADIUS) || dM < kmToNorm(MOON_RADIUS)) {
                escapeReason = 'Collided with primary body';
                break;
            }
            
            s = next;
            t += dt;
        }
        if (crossed_count < num_crossings) return { failed: true, reason: `Only ${crossed_count}/${num_crossings} crossings. ${escapeReason}` };
        
        let diff = [
            (use_y_sec ? return_state.x : return_state.y) - uv[0],
            return_state.vx - uv[1],
            return_state.vy - uv[2]
        ];
        return { diff, return_state, return_t, crossings };
    };

    if (dry_run) {
        return evaluateRun(u);
    }

    let last_err = null;
    // Newton solver with finite differences
    for (let iter = 0; iter < 50; iter++) {
        // Yield to allow new messages to update latestSearchId and so UI receives progress
        await new Promise(r => setTimeout(r, 0));
        if (searchId !== -1 && searchId !== latestSearchId) {
            return { failed: true, reason: 'Aborted for newer search' };
        }

        let res = evaluateRun(u);
        if (res && res.failed) return { error: `Eval failed: ${res.reason}` };
        
        let dist_err_km = Math.abs(res.diff[0]) * DIST_UNIT;
        let vel_err_ms = Math.sqrt(res.diff[1]**2 + res.diff[2]**2) * VEL_UNIT * 1000;
        
        // Error norm
        let err = Math.sqrt(res.diff[0]**2 + res.diff[1]**2 + res.diff[2]**2);
        last_err = { dist: dist_err_km, vel: vel_err_ms };
        
        if (progressCallback) progressCallback(iter, dist_err_km, vel_err_ms);
        
        if (err < 1e-6) {
            // Converged
            return {
                state: {
                    x: use_y_sec ? u[0] : sec_val,
                    y: use_y_sec ? sec_val : u[0],
                    vx: u[1],
                    vy: u[2]
                },
                period: res.return_t,
                crossings: res.crossings
            };
        }
        
        // Jacobian using finite differences
        let J = [[0,0,0], [0,0,0], [0,0,0]];
        let d = 1e-6; // Smaller perturbation size for highly chaotic multi-turn orbits
        let jac_failed = false;
        let jac_fail_reason = "";
        for (let i = 0; i < 3; i++) {
            let u_pert = [...u];
            u_pert[i] += d;
            let res_pert = evaluateRun(u_pert);
            if (res_pert && res_pert.failed) {
                // If forward step fails, try backward
                u_pert[i] = u[i] - 2*d;
                res_pert = evaluateRun(u_pert);
                if (res_pert && res_pert.failed) {
                    jac_failed = true;
                    jac_fail_reason = res_pert.reason;
                    break;
                }
                for (let j = 0; j < 3; j++) {
                    J[j][i] = (res.diff[j] - res_pert.diff[j]) / d; // Reverse sign
                }
                continue;
            }
            for (let j = 0; j < 3; j++) {
                J[j][i] = (res_pert.diff[j] - res.diff[j]) / d;
            }
        }
        if (jac_failed) return { error: `Jacobian failed: ${jac_fail_reason}` };
        
        // Invert J (3x3)
        let det = J[0][0]*(J[1][1]*J[2][2] - J[1][2]*J[2][1]) -
                  J[0][1]*(J[1][0]*J[2][2] - J[1][2]*J[2][0]) +
                  J[0][2]*(J[1][0]*J[2][1] - J[1][1]*J[2][0]);
        
        if (Math.abs(det) < 1e-12) return { error: 'Singular Jacobian' }; // Singular
        
        let invJ = [
            [(J[1][1]*J[2][2] - J[1][2]*J[2][1])/det, (J[0][2]*J[2][1] - J[0][1]*J[2][2])/det, (J[0][1]*J[1][2] - J[0][2]*J[1][1])/det],
            [(J[1][2]*J[2][0] - J[1][0]*J[2][2])/det, (J[0][0]*J[2][2] - J[0][2]*J[2][0])/det, (J[0][2]*J[1][0] - J[0][0]*J[1][2])/det],
            [(J[1][0]*J[2][1] - J[1][1]*J[2][0])/det, (J[0][1]*J[2][0] - J[0][0]*J[2][1])/det, (J[0][0]*J[1][1] - J[0][1]*J[1][0])/det]
        ];
        
        // Newton step
        let step = [0, 0, 0];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                step[i] += invJ[i][j] * res.diff[j];
            }
        }
        
        // Limit step size
        let step_len = Math.sqrt(step[0]**2 + step[1]**2 + step[2]**2);
        if (step_len > 0.05) {
            for (let i = 0; i < 3; i++) step[i] = step[i] * 0.05 / step_len;
        }
        
        for (let i = 0; i < 3; i++) u[i] -= step[i];
    }
    
    return { error: `Did not converge within max iterations (dist mismatch: ${last_err ? last_err.dist.toFixed(1) : '?'} km, vel mismatch: ${last_err ? last_err.vel.toFixed(1) : '?'} m/s)` }; // Did not converge
}

// ============================================================================
// WORKER MESSAGE HANDLING
// ============================================================================
self.onmessage = async function(e) {
    const { type, payload } = e.data;

    if (type === 'FIND_PERIODIC_ORBIT') {
        latestSearchId = payload.id;
        const payloadState = payload.state;
        const max_crossings = payload.max_crossings || 1;
        let result = null;
        let evaluateAll = await findGeneralPeriodicOrbit(payloadState, max_crossings, true, null, payload.id);
        
        if (latestSearchId !== payload.id) return;
        
        let attempts = [];
        if (evaluateAll && evaluateAll.crossings) {
            const use_y_sec = Math.abs(payloadState.vy) > Math.abs(payloadState.vx);
            const mapNorm = 50000 / DIST_UNIT;
            const velNorm = 1.5 / VEL_UNIT;
            
            evaluateAll.crossings.forEach((c, idx) => {
                let err;
                if (use_y_sec) {
                    // Section is y = const. Plot is x vs vx
                    const diffX = (c.x - payloadState.x) / mapNorm;
                    const diffVx = (c.vx - payloadState.vx) / velNorm;
                    err = Math.sqrt(diffX*diffX + diffVx*diffVx);
                } else {
                    // Section is x = const. Plot is y vs vy
                    const diffY = (c.y - payloadState.y) / mapNorm;
                    const diffVy = (c.vy - payloadState.vy) / velNorm;
                    err = Math.sqrt(diffY*diffY + diffVy*diffVy);
                }
                attempts.push({ k: idx + 1, err, state: c });
            });
            // Try solving for the k-crossings that naturally have the smallest mismatch first
            attempts.sort((a,b) => a.err - b.err);
        } else {
            // Fallback
            for (let i=1; i<=max_crossings; i++) attempts.push({k: i});
        }
        
        let eval_crossings = evaluateAll ? evaluateAll.crossings : [];
        
        for (let opt of attempts) {
            if (latestSearchId !== payload.id) return;
            const guessState = opt.state ? opt.state : payloadState;
            postMessage({ type: 'PERIODIC_ORBIT_PROGRESS', payload: { id: payload.id, k: opt.k, init: true } });
            result = await findGeneralPeriodicOrbit(guessState, opt.k, false, (iter, distKm, velMs) => {
                postMessage({ 
                    type: 'PERIODIC_ORBIT_PROGRESS', 
                    payload: { 
                        id: payload.id, 
                        k: opt.k, 
                        iter: iter, 
                        dist_km: distKm, 
                        vel_ms: velMs 
                    } 
                });
            }, payload.id);
            if (result && result.state) {
                break;
            }
        }
        
        // Return latest crossings found for visualization
        const crossings = (result && result.state && result.crossings) ? result.crossings : eval_crossings;

        // Only return path if converged
        if (result && result.state) {
            const propRes = propagate(result.state, result.period * 1.05, 0.005, 0, Math.max(4000, max_crossings * 1000), true);
            postMessage({ type: 'PERIODIC_ORBIT_FOUND', payload: { id: payload.id, state: result.state, path: propRes.path, period: result.period, crossings } });
        } else {
            postMessage({ type: 'PERIODIC_ORBIT_FAILED', payload: { id: payload.id, crossings, reason: result ? result.error : 'Unknown error' } });
        }
    } else if (type === 'GENERATE_MANIFOLDS') {
        const { duration_norm = daysToNorm(60), amp_l1, amp_l2, jacobi_C } = payload || {};

        const lp = solveLagrangePoints();
        const l1 = lp.l1, l2 = lp.l2, l3 = lp.l3, l4 = lp.l4, l5 = lp.l5;

        // Actual Jacobi constants at each Lagrange point
        const C_L1 = 2 * getPotential(l1, 0);
        const C_L2 = 2 * getPotential(l2, 0);
        const l1_open = jacobi_C === undefined || jacobi_C < C_L1;
        const l2_open = jacobi_C === undefined || jacobi_C < C_L2;

        let final_amp_l1 = null, final_amp_l2 = null;
        if (jacobi_C !== undefined) {
            if (l1_open) final_amp_l1 = computeAmplitudeFromJacobi(l1, jacobi_C);
            if (l2_open) final_amp_l2 = computeAmplitudeFromJacobi(l2, jacobi_C);
        } else {
            final_amp_l1 = amp_l1 || 10000;
            final_amp_l2 = amp_l2 || 20000;
        }

        const l1_orbit = l1_open ? computeLyapunov(l1, final_amp_l1) : null;
        const l2_orbit = l2_open ? computeLyapunov(l2, final_amp_l2) : null;

        // Send updated orbits to main thread immediately so UI updates
        const l1_decomp = getEigenDecomposition(l1);
        const l2_decomp = getEigenDecomposition(l2);
        
        postMessage({
            type: 'SYSTEM_INFO',
            payload: {
                l1: { x: l1, decomp: l1_decomp, orbit: l1_orbit },
                l2: { x: l2, decomp: l2_decomp, orbit: l2_orbit },
                l3: { x: l3, y: 0 },
                l4: l4,
                l5: l5
            }
        });

        generateManifolds(duration_norm, final_amp_l1, final_amp_l2);

    } else if (type === 'COMPUTE_SYSTEM_INFO') {
        const lp = solveLagrangePoints();
        const l1 = lp.l1, l2 = lp.l2, l3 = lp.l3, l4 = lp.l4, l5 = lp.l5;
        
        const l1_decomp = getEigenDecomposition(l1);
        const l2_decomp = getEigenDecomposition(l2);
        
        // Compute Orbits
        // Default amplitudes: L1=10000km, L2=20000km
        const l1_orbit = computeLyapunov(l1, 10000);
        const l2_orbit = computeLyapunov(l2, 20000);
        
        postMessage({
            type: 'SYSTEM_INFO',
            payload: {
                l1: { x: l1, decomp: l1_decomp, orbit: l1_orbit },
                l2: { x: l2, decomp: l2_decomp, orbit: l2_orbit },
                l3: { x: l3, y: 0 },
                l4: l4,
                l5: l5
            }
        });
    }
};

// ============================================================================
// MANIFOLD GENERATION (Rigorous)
// ============================================================================

function matMul(A, B) {
    const C = new Float64Array(16);
    for(let i=0; i<4; i++) {
        for(let j=0; j<4; j++) {
            let sum = 0;
            for(let k=0; k<4; k++) sum += A[i*4+k] * B[k*4+j];
            C[i*4+j] = sum;
        }
    }
    return C;
}

function matVecMul(A, v) {
    const r = [0,0,0,0];
    for(let i=0; i<4; i++) {
        for(let j=0; j<4; j++) r[i] += A[i*4+j] * v[j];
    }
    return r;
}

function invertMatrix(M) {
    const dim = 4;
    const A = new Float64Array(M); 
    const I = new Float64Array(16);
    for(let i=0; i<16; i++) I[i] = (i%5===0) ? 1 : 0;
    
    for(let i=0; i<dim; i++) {
        let pivot = A[i*4+i];
        if(Math.abs(pivot) < 1e-12) return null;
        for(let j=0; j<dim; j++) {
            A[i*4+j] /= pivot;
            I[i*4+j] /= pivot;
        }
        for(let k=0; k<dim; k++) {
            if(k === i) continue;
            let factor = A[k*4+i];
            for(let j=0; j<dim; j++) {
                A[k*4+j] -= factor * A[i*4+j];
                I[k*4+j] -= factor * I[i*4+j];
            }
        }
    }
    return I;
}

function getVariationalDerivatives(s, t) {
    const state = {x: s[0], y: s[1], vx: s[2], vy: s[3]};
    const derivState = derivatives(state, t);
    const J = getJacobian(state);
    
    const A = [
        0, 0, 1, 0,
        0, 0, 0, 1,
        J.Uxx, J.Uxy, 0, 2,
        J.Uxy, J.Uyy, -2, 0
    ];
    
    // Phi_dot = A * Phi
    const Phi = s.slice(4);
    const PhiDot = matMul(A, Phi);
    
    const ds = new Float64Array(20);
    ds[0] = derivState.dx;
    ds[1] = derivState.dy;
    ds[2] = derivState.dvx;
    ds[3] = derivState.dvy;
    for(let i=0; i<16; i++) ds[4+i] = PhiDot[i];
    
    return ds;
}

function rk4Variational(s, dt, t) {
    const k1 = getVariationalDerivatives(s, t);
    
    let s2 = new Float64Array(20);
    for(let i=0;i<20;i++) s2[i] = s[i] + k1[i]*dt/2;
    const k2 = getVariationalDerivatives(s2, t + dt/2);
    
    let s3 = new Float64Array(20);
    for(let i=0;i<20;i++) s3[i] = s[i] + k2[i]*dt/2;
    const k3 = getVariationalDerivatives(s3, t + dt/2);
    
    let s4 = new Float64Array(20);
    for(let i=0;i<20;i++) s4[i] = s[i] + k3[i]*dt;
    const k4 = getVariationalDerivatives(s4, t + dt);
    
    let next = new Float64Array(20);
    for(let i=0;i<20;i++) next[i] = s[i] + (dt/6)*(k1[i] + 2*k2[i] + 2*k3[i] + k4[i]);
    
    return next;
}

function powerIteration(M, invert=false) {
    let targetM = M;
    if (invert) {
        targetM = invertMatrix(M);
        if (!targetM) return null;
    }
    
    // Random initial vector
    let v = [Math.random(), Math.random(), Math.random(), Math.random()];
    let norm = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2 + v[3]**2);
    for(let i=0; i<4; i++) v[i] /= norm;
    
    for(let iter=0; iter<50; iter++) {
        v = matVecMul(targetM, v);
        norm = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2 + v[3]**2);
        for(let i=0; i<4; i++) v[i] /= norm;
    }
    return v;
}

// Binary search for the Lyapunov amplitude that yields a given Jacobi constant.
// C decreases monotonically as amplitude increases.
function computeAmplitudeFromJacobi(l_x, target_C) {
    const C_L = 2 * getPotential(l_x, 0);
    if (target_C >= C_L) return 200; // above L-point energy, return minimal orbit

    let lo = 200;    // km – tiny orbit, C ≈ C_L
    let hi = 55000;  // km – large orbit, much lower C

    for (let iter = 0; iter < 10; iter++) {
        const mid = (lo + hi) / 2;
        const orbit = computeLyapunov(l_x, mid);
        if (!orbit || !orbit.vy0) { hi = mid; continue; }
        const x0 = l_x - kmToNorm(mid);
        const C_orbit = 2 * getPotential(x0, 0) - orbit.vy0 * orbit.vy0;
        if (C_orbit > target_C) lo = mid;  // C too high → orbit too small
        else                    hi = mid;  // C too low  → orbit too large
    }
    return (lo + hi) / 2;
}

function generateManifolds(duration, amp_l1 = null, amp_l2 = null) {
    console.log(`Generating Manifolds: Duration=${duration}, L1_Amp=${amp_l1}, L2_Amp=${amp_l2}`);
    const { l1, l2 } = solveLagrangePoints();

    let l1_orbit = null, l2_orbit = null;
    const manifolds = [];
    const poincareIntersections = [];
    let manifoldIdCounter = 0;
    const epsilon = 1e-5;
    const moon_x = 1 - MASS_RATIO;
    const earth_x = -MASS_RATIO;
    const r_hill_norm = Math.pow(MASS_RATIO / (3 * (1 - MASS_RATIO)), 1/3);

    if (amp_l1 !== null) { // L1 neck open
    // 1. Compute L1 Lyapunov Orbit
    l1_orbit = computeLyapunov(l1, amp_l1);

    // Initial State of Orbit
    const x0 = l1 - kmToNorm(amp_l1);
    const vy0 = l1_orbit.vy0;
    const period = l1_orbit.period;
    
    // 2. Integrate Variational Equations for one period to get Monodromy Matrix (M)
    // Initial Augmented State: [x, y, vx, vy, 1, 0, 0, 0, 0, 1, 0, 0, ...]
    let s = new Float64Array(20);
    s[0] = x0; s[1] = 0; s[2] = 0; s[3] = vy0;
    // Identity matrix for Phi
    s[4] = 1; s[9] = 1; s[14] = 1; s[19] = 1;
    
    const steps = 2000;
    const dt = period / steps;
    
    // We will store orbit points and STMs along the orbit for sampling
    const orbitSamples = [];
    const sampleInterval = Math.floor(steps / 32); // 32 samples
    const poincareIntersections = [];
    
    let t = 0;
    for(let i=0; i<=steps; i++) {
        if (i % sampleInterval === 0 && orbitSamples.length < 32) {
            // Store current state and STM phi(t, 0)
            const phi_t_0 = s.slice(4);
            const state_t = { x: s[0], y: s[1], vx: s[2], vy: s[3] };
            orbitSamples.push({ state: state_t, phi: phi_t_0 });
        }
        s = rk4Variational(s, dt, t);
        t += dt;
    }
    
    // Monodromy Matrix M = Phi(T, 0)
    const M = s.slice(4);
    
    // 3. Eigendecomposition of M
    // Unstable Eigenvector (v_u) corresponds to largest eigenvalue of M
    const v_u = powerIteration(M, false);
    
    // Stable Eigenvector (v_s) corresponds to largest eigenvalue of M^-1 (smallest of M)
    const v_s = powerIteration(M, true);
    
    // 4. Generate Manifolds from Samples
    orbitSamples.forEach((sample, idx) => {
        // Transform eigenvectors to local time
        let local_vu = matVecMul(sample.phi, v_u);
        let local_vs = matVecMul(sample.phi, v_s);
        
        // Normalize
        const norm_u = Math.sqrt(local_vu[0]**2 + local_vu[1]**2 + local_vu[2]**2 + local_vu[3]**2);
        const norm_s = Math.sqrt(local_vs[0]**2 + local_vs[1]**2 + local_vs[2]**2 + local_vs[3]**2);
        
        for(let k=0; k<4; k++) local_vu[k] /= norm_u;
        for(let k=0; k<4; k++) local_vs[k] /= norm_s;
        
// --- UNSTABLE MANIFOLDS (Forward) ---
        // Iterate both directions (+1, -1) along the eigenvector
        [1, -1].forEach(dir => {
            const manifoldId = ++manifoldIdCounter;
            
            const state_u = {
                x: sample.state.x + epsilon * local_vu[0] * dir,
                y: sample.state.y + epsilon * local_vu[1] * dir,
                vx: sample.state.vx + epsilon * local_vu[2] * dir,
                vy: sample.state.vy + epsilon * local_vu[3] * dir
            };
            
            // Check direction relative to L1 x-coordinate
            // If perturbed x > x_sample, it's going towards Moon.
            const is_moon_bound = (state_u.x > sample.state.x); 
            
            // If Moon-bound, stop at vertical Moon line
            // If Earth-bound, stop at horizontal crossing (y=0) BEHIND Earth (x < earth_x)
            const stopFn = is_moon_bound 
                ? (s) => (s.x >= moon_x) 
                : (s, prev_s) => (s.x < earth_x && s.y * prev_s.y < 0);
            
            // Propagate
            // Increase duration for Earth-bound as it takes longer to swing around
            const prop_duration = is_moon_bound ? duration : duration * 4;
            const res_u = propagate(state_u, prop_duration, 0.002, 0, 10000, true, stopFn);
            
            // Perform Intersection Check
            for(let k=0; k<res_u.path.length-1; k++) {
                const p1 = res_u.path[k];
                const p2 = res_u.path[k+1];
                
                // Vertical (Moon X)
                if ((p1.x - moon_x) * (p2.x - moon_x) < 0) {
                     const t_int = (moon_x - p1.x) / (p2.x - p1.x);
                     const y_int = p1.y + t_int * (p2.y - p1.y);
                     
                     // Clip to Hill Sphere (U2/U3)
                     if (Math.abs(y_int) <= r_hill_norm) {
                         const vy_int = p1.vy + t_int * (p2.vy - p1.vy);
                         const vx_int = p1.vx + t_int * (p2.vx - p1.vx);
                         poincareIntersections.push({ x: moon_x, y: y_int, vx: vx_int, vy: vy_int, type: 'unstable', location: 'vertical_moon', manifoldId });
                     }
                }
                
                // Horizontal (y = 0, Left of Earth)
                if (p1.y * p2.y < 0 && p1.x <= earth_x - kmToNorm(EARTH_RADIUS)) {
                     const t_int = (0 - p1.y) / (p2.y - p1.y);
                     const x_int = p1.x + t_int * (p2.x - p1.x);
                     const vx_int = p1.vx + t_int * (p2.vx - p1.vx);
                     const vy_int = p1.vy + t_int * (p2.vy - p1.vy);
                     poincareIntersections.push({ x: x_int, y: 0, vx: vx_int, vy: vy_int, type: 'unstable', location: 'horizontal_left', manifoldId });
                }
            }
            
            // Keep all 32 paths for visual rendering
            manifolds.push({ type: 'unstable', path: res_u.path, id: manifoldId, lpoint: 'l1' });

            // Only use Moon-bound trajectories for Ballistic Capture Seeding
            // (Keep this logic restricted to visual subset or all? 
            // Optimally, use all for better seeding, but maybe expensive. 
            // Let's stick to using the visual subset for consistency with current search density 
            // or just use all if high density search is desired. 
            // For now, let's restrict seeding to the subset to avoid explosion of seeds.)

        });

        // --- STABLE MANIFOLDS (Backward) ---
        // Iterate both directions
        [1, -1].forEach(dir => {
            const manifoldId = ++manifoldIdCounter; // New ID
            const state_s = {
                x: sample.state.x + epsilon * local_vs[0] * dir,
                y: sample.state.y + epsilon * local_vs[1] * dir,
                vx: sample.state.vx + epsilon * local_vs[2] * dir,
                vy: sample.state.vy + epsilon * local_vs[3] * dir
            };
            
            // Stable manifold is arriving. 
            // If perturbed x > x_sample (right), it originated from Moon side.
            // If perturbed x < x_sample (left), it originated from Earth side.
            const is_from_moon = (state_s.x > sample.state.x);

            const stopFn = is_from_moon 
                ? (s) => (s.x >= moon_x) 
                : (s, prev_s) => (s.x < earth_x && s.y * prev_s.y < 0);

            // Perform Intersection Check (U2/U3 at x = moon_x)
            // U3: y > 0 (roughly), U2: y < 0 (roughly). But we just store all interactions at x=moon_x.
            // The UI filters by yMin/yMax.
            
            const prop_duration = is_from_moon ? duration : duration * 4;
            const res_s = propagate(state_s, prop_duration, -0.002, 0, 10000, true, stopFn); // Re-add missing propagation
            
                // Check Intersections
                for(let k=0; k<res_s.path.length-1; k++) {
                    const p1 = res_s.path[k];
                    const p2 = res_s.path[k+1];
                    
                    // Vertical (x = moon_x)
                    if ((p1.x - moon_x) * (p2.x - moon_x) < 0) {
                         const t_int = (moon_x - p1.x) / (p2.x - p1.x);
                         const y_int = p1.y + t_int * (p2.y - p1.y);
                         
                         // Clip to Hill Sphere (U2/U3)
                         if (Math.abs(y_int) <= r_hill_norm) {
                             const vy_int = p1.vy + t_int * (p2.vy - p1.vy);
                             const vx_int = p1.vx + t_int * (p2.vx - p1.vx);
                             poincareIntersections.push({ x: moon_x, y: y_int, vx: vx_int, vy: vy_int, type: 'stable', location: 'vertical_moon', manifoldId });
                         }
                    }
                    
                    // Horizontal (y = 0, Left of Earth)
                    if (p1.y * p2.y < 0 && p1.x <= earth_x - kmToNorm(EARTH_RADIUS)) {
                         const t_int = (0 - p1.y) / (p2.y - p1.y);
                         const x_int = p1.x + t_int * (p2.x - p1.x);
                         const vx_int = p1.vx + t_int * (p2.vx - p1.vx);
                         const vy_int = p1.vy + t_int * (p2.vy - p1.vy);
                         poincareIntersections.push({ x: x_int, y: 0, vx: vx_int, vy: vy_int, type: 'stable', location: 'horizontal_left', manifoldId });
                    }
                }

                // Keep all 32 paths for visual rendering
                manifolds.push({ type: 'stable', path: res_s.path, id: manifoldId, lpoint: 'l1' });
            });
        });
    } // end L1 block

    // ========================================================================
    // L2 STABLE MANIFOLDS (Interior & Exterior)
    // ========================================================================
    if (amp_l2 !== null) { // L2 neck open
        // 1. Compute L2 Lyapunov Orbit
        l2_orbit = computeLyapunov(l2, amp_l2);
        
        // Initial State
        const x0 = l2 - kmToNorm(amp_l2);
        const vy0 = l2_orbit.vy0;
        const period = l2_orbit.period;
        
        // 2. Monodromy Matrix (M) - Reusing buffers
        let s = new Float64Array(20);
        s[0] = x0; s[1] = 0; s[2] = 0; s[3] = vy0;
        s[4] = 1; s[9] = 1; s[14] = 1; s[19] = 1; 
        
        const steps = 2000;
        const dt = period / steps;
        
        const orbitSamples = [];
        const sampleInterval = Math.floor(steps / 32); // 32 samples
        
        let t = 0;
        for(let i=0; i<=steps; i++) {
            if (i % sampleInterval === 0 && orbitSamples.length < 32) {
                const phi_t_0 = s.slice(4);
                const state_t = { x: s[0], y: s[1], vx: s[2], vy: s[3] };
                orbitSamples.push({ state: state_t, phi: phi_t_0 });
            }
            s = rk4Variational(s, dt, t);
            t += dt;
        }
        
        // Capture Monodromy Matrix for L2
        const M_l2 = s.slice(4);
        
        // Stable Eigenvector (v_s) -> Backward
        const v_s = powerIteration(M_l2, true); 
        // Unstable Eigenvector (v_u) -> Forward
        const v_u = powerIteration(M_l2, false);

        const epsilon = 1e-5; 
        const moon_x = 1 - MASS_RATIO;
        const earth_x = -MASS_RATIO;
        
        orbitSamples.forEach((sample, idx) => {
            let local_vs = matVecMul(sample.phi, v_s);
            let local_vu = matVecMul(sample.phi, v_u);
            
            const norm_s = Math.sqrt(local_vs[0]**2 + local_vs[1]**2 + local_vs[2]**2 + local_vs[3]**2);
            const norm_u = Math.sqrt(local_vu[0]**2 + local_vu[1]**2 + local_vu[2]**2 + local_vu[3]**2);
            
            for(let k=0; k<4; k++) local_vs[k] /= norm_s;
            for(let k=0; k<4; k++) local_vu[k] /= norm_u;
            
            // --- L2 STABLE MANIFOLDS (Backward) ---
            [1, -1].forEach(dir => {
                const manifoldId = ++manifoldIdCounter; // New ID
                const state_s = {
                    x: sample.state.x + epsilon * local_vs[0] * dir,
                    y: sample.state.y + epsilon * local_vs[1] * dir,
                    vx: sample.state.vx + epsilon * local_vs[2] * dir,
                    vy: sample.state.vy + epsilon * local_vs[3] * dir
                };

                const is_interior = (state_s.x < sample.state.x);
                const stopFn = is_interior
                    ? (s) => (s.x <= moon_x)
                    : (s, prev_s) => (s.x < earth_x && s.y * prev_s.y < 0);
                    
                const prop_duration = is_interior ? duration : duration * 8;
                const max_steps = is_interior ? 10000 : 40000;
                
                const res_s = propagate(state_s, prop_duration, -0.002, 0, max_steps, true, stopFn);

                // Check Intersections
                for(let k=0; k<res_s.path.length-1; k++) {
                    const p1 = res_s.path[k];
                    const p2 = res_s.path[k+1];
                    
                    // Vertical Moon
                    if ((p1.x - moon_x) * (p2.x - moon_x) < 0) {
                         const t_int = (moon_x - p1.x) / (p2.x - p1.x);
                         const y_int = p1.y + t_int * (p2.y - p1.y);
                         
                         // Clip to Hill Sphere (U2/U3)
                         if (Math.abs(y_int) <= r_hill_norm) {
                             const vy_int = p1.vy + t_int * (p2.vy - p1.vy);
                             const vx_int = p1.vx + t_int * (p2.vx - p1.vx);
                             poincareIntersections.push({ x: moon_x, y: y_int, vx: vx_int, vy: vy_int, type: 'stable', location: 'vertical_moon', manifoldId });
                         }
                    }
                    
                    // Horizontal Left
                    if (p1.y * p2.y < 0 && p1.x <= earth_x - kmToNorm(EARTH_RADIUS)) {
                         const t_int = (0 - p1.y) / (p2.y - p1.y);
                         const x_int = p1.x + t_int * (p2.x - p1.x);
                         const vx_int = p1.vx + t_int * (p2.vx - p1.vx);
                         const vy_int = p1.vy + t_int * (p2.vy - p1.vy);
                         poincareIntersections.push({ x: x_int, y: 0, vx: vx_int, vy: vy_int, type: 'stable', location: 'horizontal_left', manifoldId });
                    }
                }


                // Keep 32 samples
                if (res_s.path.length > 10) {
                     manifolds.push({ type: 'stable', path: res_s.path, id: manifoldId, lpoint: 'l2' });
                }
            });

            // --- L2 UNSTABLE MANIFOLDS (Forward) ---
            [1, -1].forEach(dir => {
                const manifoldId = ++manifoldIdCounter; // New ID
                const state_u = {
                    x: sample.state.x + epsilon * local_vu[0] * dir,
                    y: sample.state.y + epsilon * local_vu[1] * dir,
                    vx: sample.state.vx + epsilon * local_vu[2] * dir,
                    vy: sample.state.vy + epsilon * local_vu[3] * dir
                };

                const is_interior = (state_u.x < sample.state.x);
                const stopFn = is_interior
                    ? (s) => (s.x <= moon_x) 
                    : (s, prev_s) => (s.x < earth_x && s.y * prev_s.y < 0); 

                const prop_duration = is_interior ? duration : duration * 8;
                const max_steps = is_interior ? 10000 : 40000;

                const res_u = propagate(state_u, prop_duration, 0.002, 0, max_steps, true, stopFn);

                // Check Intersections
                for(let k=0; k<res_u.path.length-1; k++) {
                    const p1 = res_u.path[k];
                    const p2 = res_u.path[k+1];
                    
                    // Vertical Moon
                     if ((p1.x - moon_x) * (p2.x - moon_x) < 0) {
                          const t_int = (moon_x - p1.x) / (p2.x - p1.x);
                          const y_int = p1.y + t_int * (p2.y - p1.y);
                          
                          // Clip to Hill Sphere (U2/U3)
                          if (Math.abs(y_int) <= r_hill_norm) {
                              const vy_int = p1.vy + t_int * (p2.vy - p1.vy);
                              const vx_int = p1.vx + t_int * (p2.vx - p1.vx);
                              poincareIntersections.push({ x: moon_x, y: y_int, vx: vx_int, vy: vy_int, type: 'unstable', location: 'vertical_moon', manifoldId });
                          }
                     }
                    
                    // Horizontal Left
                    if (p1.y * p2.y < 0 && p1.x <= earth_x - kmToNorm(EARTH_RADIUS)) {
                         const t_int = (0 - p1.y) / (p2.y - p1.y);
                         const x_int = p1.x + t_int * (p2.x - p1.x);
                         const vx_int = p1.vx + t_int * (p2.vx - p1.vx);
                         const vy_int = p1.vy + t_int * (p2.vy - p1.vy);
                         poincareIntersections.push({ x: x_int, y: 0, vx: vx_int, vy: vy_int, type: 'unstable', location: 'horizontal_left', manifoldId });
                    }
                }


                // Keep 32 samples
                if (res_u.path.length > 10) {
                    manifolds.push({ type: 'unstable', path: res_u.path, id: manifoldId, lpoint: 'l2' });
                }
            });
        });
    } // end L2 block

    postMessage({
        type: 'MANIFOLDS_GENERATED',
        payload: {
            manifolds: manifolds,
            intersections: poincareIntersections,
            l1_orbit: l1_orbit,
            l2_orbit: l2_orbit
        }
    });
}

