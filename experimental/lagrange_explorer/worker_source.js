const WORKER_SOURCE = `
    let mu = 0.0121;
    let sunEnabled = false;
    const SUN_DIST = 389; 
    const SUN_MASS = 328900; 
    const SUN_OMEGA = -0.9252;

    self.onmessage = function(e) {
        if (e.data.type === 'optimize') {
            const data = e.data;
            mu = data.mu;
            sunEnabled = data.sunEnabled;
            // Solve
            const res = solveGeneralPeriodic(data.state.x, data.state.y, data.state.vx, data.state.vy, data.state.t);
            self.postMessage({ result: res });
        }
    };

    function derivatives(s) {
        const r1_sq = (s.x + mu)**2 + s.y**2;
        const r2_sq = (s.x - (1 - mu))**2 + s.y**2;
        const r1_cubed = Math.pow(r1_sq, 1.5);
        const r2_cubed = Math.pow(r2_sq, 1.5);
        
        let ax = 2*s.vy + s.x - (1-mu)*(s.x + mu)/r1_cubed - mu*(s.x - (1-mu))/r2_cubed;
        let ay = -2*s.vx + s.y - (1-mu)*s.y/r1_cubed - mu*s.y/r2_cubed;
        
        if (sunEnabled && typeof s.t !== 'undefined') {
            const theta = SUN_OMEGA * s.t;
            const xs = SUN_DIST * Math.cos(theta);
            const ys = SUN_DIST * Math.sin(theta);
            const rs_sq = (s.x - xs)**2 + (s.y - ys)**2;
            const rs_cubed = Math.pow(rs_sq, 1.5);
            ax -= SUN_MASS * (s.x - xs) / rs_cubed;
            ay -= SUN_MASS * (s.y - ys) / rs_cubed;
            const d_org_cubed = Math.pow(SUN_DIST, 3);
            ax -= SUN_MASS * xs / d_org_cubed;
            ay -= SUN_MASS * ys / d_org_cubed;
        }
        return { dx: s.vx, dy: s.vy, dvx: ax, dvy: ay };
    }

    function integrate(x, y, vx, vy, time, startTime) {
        let s = { x, y, vx, vy, t: startTime }; 
        let dt = 0.002; 
        let t = 0;
        while(t < time) {
            let step = Math.min(dt, time - t);
            let k1 = derivatives(s);
            let s2 = { x: s.x + k1.dx*step/2, y: s.y + k1.dy*step/2, vx: s.vx + k1.dvx*step/2, vy: s.vy + k1.dvy*step/2, t: s.t + step/2 };
            let k2 = derivatives(s2);
            let s3 = { x: s.x + k2.dx*step/2, y: s.y + k2.dy*step/2, vx: s.vx + k2.dvx*step/2, vy: s.vy + k2.dvy*step/2, t: s.t + step/2 };
            let k3 = derivatives(s3);
            let s4 = { x: s.x + k3.dx*step, y: s.y + k3.dy*step, vx: s.vx + k3.dvx*step, vy: s.vy + k3.dvy*step, t: s.t + step };
            let k4 = derivatives(s4);
            s.x += (step/6)*(k1.dx+2*k2.dx+2*k3.dx+k4.dx);
            s.y += (step/6)*(k1.dy+2*k2.dy+2*k3.dy+k4.dy);
            s.vx += (step/6)*(k1.dvx+2*k2.dvx+2*k3.dvx+k4.dvx);
            s.vy += (step/6)*(k1.dvy+2*k2.dvy+2*k3.dvy+k4.dvy);
            s.t += step;
            t += step;
        }
        return s;
    }

    function getProjectedPath(startX, startY, vx, vy, duration, startTime, dt = 0.01) {
        let s = { x: startX, y: startY, vx: vx, vy: vy, t: startTime };
        let path = [];
        for (let t = 0; t < duration; t += dt) {
            let k1 = derivatives(s);
            let s2 = { x: s.x + k1.dx*dt/2, y: s.y + k1.dy*dt/2, vx: s.vx + k1.dvx*dt/2, vy: s.vy + k1.dvy*dt/2, t: s.t + dt/2 };
            let k2 = derivatives(s2);
            let s3 = { x: s.x + k2.dx*dt/2, y: s.y + k2.dy*dt/2, vx: s.vx + k2.dvx*dt/2, vy: s.vy + k2.dvy*dt/2, t: s.t + dt/2 };
            let k3 = derivatives(s3);
            let s4 = { x: s.x + k3.dx*dt, y: s.y + k3.dy*dt, vx: s.vx + k3.dvx*dt, vy: s.vy + k3.dvy*dt, t: s.t + dt };
            let k4 = derivatives(s4);
            s.x += (dt/6)*(k1.dx + 2*k2.dx + 2*k3.dx + k4.dx);
            s.y += (dt/6)*(k1.dy + 2*k2.dy + 2*k3.dy + k4.dy);
            s.vx += (dt/6)*(k1.dvx + 2*k2.dvx + 2*k3.dvx + k4.dvx);
            s.vy += (dt/6)*(k1.dvy + 2*k2.dvy + 2*k3.dvy + k4.dvy);
            s.t += dt;
            path.push({x: s.x, y: s.y, vx: s.vx, vy: s.vy});
        }
        return path;
    }

    function findReturnState(x, y, vx, vy, startTime) {
        let s = { x, y, vx, vy, t: startTime };
        let minErr = { t: 6.0, val: 1e9, x: x, y: y, found: false };
        let dt = 0.02;
        let maxT = 18; 
        let hasLeft = false;
        for(let t=0; t<maxT; t+=dt) {
            let k1 = derivatives(s);
            let s2 = { x: s.x + k1.dx*dt/2, y: s.y + k1.dy*dt/2, vx: s.vx + k1.dvx*dt/2, vy: s.vy + k1.dvy*dt/2, t: s.t + dt/2 };
            let k2 = derivatives(s2);
            let s3 = { x: s.x + k2.dx*dt/2, y: s.y + k2.dy*dt/2, vx: s.vx + k2.dvx*dt/2, vy: s.vy + k2.dvy*dt/2, t: s.t + dt/2 };
            let k3 = derivatives(s3);
            let s4 = { x: s.x + k3.dx*dt, y: s.y + k3.dy*dt, vx: s.vx + k3.dvx*dt, vy: s.vy + k3.dvy*dt, t: s.t + dt };
            let k4 = derivatives(s4);
            s.x += (dt/6)*(k1.dx+2*k2.dx+2*k3.dx+k4.dx);
            s.y += (dt/6)*(k1.dy+2*k2.dy+2*k3.dy+k4.dy);
            s.vx += (dt/6)*(k1.dvx+2*k2.dvx+2*k3.dvx+k4.dvx);
            s.vy += (dt/6)*(k1.dvy+2*k2.dvy+2*k3.dvy+k4.dvy);
            s.t += dt;
            let dist = Math.hypot(s.x - x, s.y - y);
            let err = Math.hypot(s.x - x, s.y - y, s.vx - vx, s.vy - vy);
            if (dist > 0.1) hasLeft = true; 
            if (hasLeft && t > 1.0) {
                if (err < minErr.val) { minErr = { t: t + dt, val: err, x: s.x, y: s.y, found: true }; }
            }
        }
        return minErr; 
    }
    
    function invert4x4(m) {
        let size = 4;
        let aug = [];
        for(let i=0; i<size; i++) {
            aug[i] = [...m[i]];
            for(let j=0; j<size; j++) aug[i].push(i===j? 1:0);
        }
        for(let i=0; i<size; i++) {
            let pivot = aug[i][i];
            if (Math.abs(pivot) < 1e-9) return null;
            for(let j=0; j<2*size; j++) aug[i][j] /= pivot;
            for(let k=0; k<size; k++) {
                if (k !== i) {
                    let factor = aug[k][i];
                    for(let j=0; j<2*size; j++) aug[k][j] -= factor * aug[i][j];
                }
            }
        }
        let res = [];
        for(let i=0; i<size; i++) res.push(aug[i].slice(size, 2*size));
        return res;
    }

    function solveGeneralPeriodic(x0, y0, vx0, vy0, startTime) {
        let T = findReturnState(x0, y0, vx0, vy0, startTime).t;
        let state = [x0, y0, vx0, vy0, T]; 
        let debugPoints = [];
        const T_init = T; 
        const maxIter = 50;
        const eps = 1e-5;
        
        for(let i=0; i<maxIter; i++) {
            if (state[4] > T_init * 1.05) state[4] = T_init * 1.05;
            if (state[4] < T_init * 0.95) state[4] = T_init * 0.95;
            
            let S = integrate(state[0], state[1], state[2], state[3], state[4], startTime);
            debugPoints.push({x: S.x, y: S.y});
            
            let R = [ S.x - state[0], S.y - state[1], S.vx - state[2], S.vy - state[3] ];
            let err = Math.hypot(R[0], R[1], R[2], R[3]);
            
            if (err < 1e-9) break; 
            
            let J = [];
            for(let j=0; j<5; j++) {
                let orig = state[j];
                state[j] += eps;
                let Sp = integrate(state[0], state[1], state[2], state[3], state[4], startTime);
                let Rp = [ Sp.x - state[0], Sp.y - state[1], Sp.vx - state[2], Sp.vy - state[3] ];
                let col = [ (Rp[0] - R[0]) / eps, (Rp[1] - R[1]) / eps, (Rp[2] - R[2]) / eps, (Rp[3] - R[3]) / eps ];
                J.push(col);
                state[j] = orig; 
            }
            
            let G = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
            for(let r=0; r<4; r++) { for(let c=0; c<4; c++) { let sum = 0; for(let k=0; k<5; k++) sum += J[k][r] * J[k][c]; G[r][c] = sum; } }
            
            let G_inv = invert4x4(G);
            if (!G_inv) break;
            
            let lambda = [0,0,0,0];
            for(let r=0; r<4; r++) { for(let c=0; c<4; c++) lambda[r] += G_inv[r][c] * (-R[c]); }
            
            let dq = [0,0,0,0,0];
            for(let k=0; k<5; k++) { for(let r=0; r<4; r++) dq[k] += J[k][r] * lambda[r]; }
            
            let alpha = 1.0;
            let improved = false;
            while(alpha > 1e-10) {
                let trialState = [ state[0] + dq[0] * alpha, state[1] + dq[1] * alpha, state[2] + dq[2] * alpha, state[3] + dq[3] * alpha, state[4] + dq[4] * alpha ];
                if (trialState[4] > T_init * 1.05) trialState[4] = T_init * 1.05;
                if (trialState[4] < T_init * 0.95) trialState[4] = T_init * 0.95;
                let S_new = integrate(trialState[0], trialState[1], trialState[2], trialState[3], trialState[4], startTime);
                let err_new = Math.hypot( S_new.x - trialState[0], S_new.y - trialState[1], S_new.vx - trialState[2], S_new.vy - trialState[3] );
                if (err_new < err) { state = trialState; improved = true; break; } else { alpha *= 0.5; }
            }
            if (!improved) break;
        }

        let S_end = integrate(state[0], state[1], state[2], state[3], state[4], startTime);
        let finalErr = Math.hypot( S_end.x - state[0], S_end.y - state[1], S_end.vx - state[2], S_end.vy - state[3] );

        if (finalErr > 1e-5) return null;

        let finalPath = getProjectedPath(state[0], state[1], state[2], state[3], 15, startTime, 0.002);
        return {
            startState: { x: state[0], y: state[1], vx: state[2], vy: state[3] },
            path: finalPath,
            debugPoints: debugPoints
        };
    }
`;
