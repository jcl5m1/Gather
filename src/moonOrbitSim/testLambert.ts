
import * as THREE from 'three';
import { TransferCalculator, generateStateFromOrbitalElements } from './orbitUtils';

/**
 * Test for Lambert Solver using two random elliptical orbits.
 */
function testLambert() {
    console.log("Running Lambert Solver Test with Random Elliptical Orbits...\n");

    // Earth gravitational parameter (km^3/s^2)
    const mu = 398600.4418;
    const centralBodyMass = mu / 6.674e-11; // Approximate Earth mass for compatibility

    // Generate random orbital parameters for orbit 1
    const rp1 = 6571 + Math.random() * 3000; // Periapsis: 6571-9571 km (200-3200 km altitude)
    const ra1 = rp1 + Math.random() * 20000; // Apoapsis: larger than periapsis
    const e1 = (ra1 - rp1) / (ra1 + rp1);
    const inclination1 = Math.random() * Math.PI / 4; // 0-45 degrees
    const lan1 = Math.random() * 2 * Math.PI; // Longitude of ascending node
    const argPeri1 = Math.random() * 2 * Math.PI; // Argument of periapsis
    const trueAnomaly1 = Math.random() * 2 * Math.PI; // Random position on orbit

    // Generate random orbital parameters for orbit 2
    const rp2 = 6571 + Math.random() * 3000;
    const ra2 = rp2 + Math.random() * 20000;
    const e2 = (ra2 - rp2) / (ra2 + rp2);
    const inclination2 = Math.random() * Math.PI / 4;
    const lan2 = Math.random() * 2 * Math.PI;
    const argPeri2 = Math.random() * 2 * Math.PI;
    const trueAnomaly2 = Math.random() * 2 * Math.PI;

    console.log("Orbit 1 Parameters:");
    console.log(`  Periapsis: ${rp1.toFixed(2)} km`);
    console.log(`  Apoapsis: ${ra1.toFixed(2)} km`);
    console.log(`  Eccentricity: ${e1.toFixed(6)}`);
    console.log(`  Inclination: ${(inclination1 * 180 / Math.PI).toFixed(2)}°`);
    console.log(`  LAN: ${(lan1 * 180 / Math.PI).toFixed(2)}°`);
    console.log(`  Arg of Periapsis: ${(argPeri1 * 180 / Math.PI).toFixed(2)}°`);
    console.log(`  True Anomaly: ${(trueAnomaly1 * 180 / Math.PI).toFixed(2)}°\n`);

    console.log("Orbit 2 Parameters:");
    console.log(`  Periapsis: ${rp2.toFixed(2)} km`);
    console.log(`  Apoapsis: ${ra2.toFixed(2)} km`);
    console.log(`  Eccentricity: ${e2.toFixed(6)}`);
    console.log(`  Inclination: ${(inclination2 * 180 / Math.PI).toFixed(2)}°`);
    console.log(`  LAN: ${(lan2 * 180 / Math.PI).toFixed(2)}°`);
    console.log(`  Arg of Periapsis: ${(argPeri2 * 180 / Math.PI).toFixed(2)}°`);
    console.log(`  True Anomaly: ${(trueAnomaly2 * 180 / Math.PI).toFixed(2)}°\n`);

    // Generate state vectors from orbital elements
    const state1 = generateStateFromOrbitalElements(
        rp1, ra1, e1, centralBodyMass,
        trueAnomaly1, inclination1, lan1, argPeri1
    );

    const state2 = generateStateFromOrbitalElements(
        rp2, ra2, e2, centralBodyMass,
        trueAnomaly2, inclination2, lan2, argPeri2
    );

    const r1 = state1.position;
    const r2 = state2.position;

    // Estimate time of flight based on Hohmann-like transfer
    const r1Mag = r1.length();
    const r2Mag = r2.length();
    const a_trans_est = (r1Mag + r2Mag) / 2;
    const dt = Math.PI * Math.sqrt(Math.pow(a_trans_est, 3) / mu);

    console.log("Lambert Problem Inputs:");
    console.log(`  r1: [${r1.x.toFixed(2)}, ${r1.y.toFixed(2)}, ${r1.z.toFixed(2)}] km`);
    console.log(`  r2: [${r2.x.toFixed(2)}, ${r2.y.toFixed(2)}, ${r2.z.toFixed(2)}] km`);
    console.log(`  r1 magnitude: ${r1Mag.toFixed(2)} km`);
    console.log(`  r2 magnitude: ${r2Mag.toFixed(2)} km`);
    console.log(`  dt (estimated): ${dt.toFixed(2)} s (${(dt / 3600).toFixed(2)} hours)`);
    console.log(`  mu: ${mu} km^3/s^2\n`);

    const solutions = TransferCalculator.solveLambert(r1, r2, dt, mu);

    if (solutions.length === 0) {
        console.error("❌ FAILED: Lambert solver returned no solutions");
        return;
    }
    
    // Use the first (best) solution
    const result = solutions[0];
    console.log(`Found ${solutions.length} solution(s), using ${result.type} (lowest delta-v)\n`);

    console.log("Lambert Solution:");
    console.log(`  v1: [${result.v1.x.toFixed(4)}, ${result.v1.y.toFixed(4)}, ${result.v1.z.toFixed(4)}] km/s`);
    console.log(`  v2: [${result.v2.x.toFixed(4)}, ${result.v2.y.toFixed(4)}, ${result.v2.z.toFixed(4)}] km/s`);
    console.log(`  v1 magnitude: ${result.v1.length().toFixed(6)} km/s`);
    console.log(`  v2 magnitude: ${result.v2.length().toFixed(6)} km/s\n`);

    // --- VERIFICATION via manual propagation ---
    console.log("Verifying Solution via Propagation...");
    
    const h = new THREE.Vector3().crossVectors(r1, result.v1);
    const hMag = h.length();
    const v1MagSq = result.v1.lengthSq();
    const energy = v1MagSq / 2 - mu / r1Mag;
    const a = -mu / (2 * energy);
    const e = Math.sqrt(Math.abs(1 + (2 * energy * hMag * hMag) / (mu * mu)));
    const period = 2 * Math.PI * Math.sqrt(Math.pow(Math.abs(a), 3) / mu);

    console.log(`  Transfer Orbit:`);
    console.log(`    Semi-major axis: ${a.toFixed(2)} km`);
    console.log(`    Eccentricity: ${e.toFixed(6)}`);
    console.log(`    Period: ${period.toFixed(2)} s (${(period / 3600).toFixed(2)} hours)`);

    // 1. Initial eccentric anomaly E0
    const radialVel0 = result.v1.dot(r1.clone().normalize());
    const theta0 = Math.atan2(hMag * radialVel0, hMag * hMag / r1Mag - mu);
    const E0 = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(theta0 / 2));
    
    // 2. Initial mean anomaly M0
    const M0 = E0 - e * Math.sin(E0);
    
    // 3. Final mean anomaly M
    const M = M0 + 2 * Math.PI * (dt / period);
    
    // 4. Solve Kepler's equation for final eccentric anomaly E
    let E = M;
    for (let i = 0; i < 20; i++) {
        E = M + e * Math.sin(E);
    }
    
    // 5. Position in orbital plane
    const xOrb = a * (Math.cos(E) - e);
    const yOrb = a * Math.sqrt(1 - e * e) * Math.sin(E);
    
    // 6. Basis vectors
    const hNorm = h.clone().normalize();
    const v1CrossH = new THREE.Vector3().crossVectors(result.v1, h);
    const eVec = v1CrossH.multiplyScalar(1 / mu).sub(r1.clone().normalize());
    const eNorm = eVec.clone().normalize();
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();
    
    // 7. Final 3D position
    const rFinal = new THREE.Vector3()
        .addScaledVector(periapsisDir, xOrb)
        .addScaledVector(perpDir, yOrb);
        
    console.log(`\nPropagation Result at t=${dt.toFixed(2)}s:`);
    console.log(`  r_final (propagated): [${rFinal.x.toFixed(2)}, ${rFinal.y.toFixed(2)}, ${rFinal.z.toFixed(2)}] km`);
    console.log(`  r_target (expected):  [${r2.x.toFixed(2)}, ${r2.y.toFixed(2)}, ${r2.z.toFixed(2)}] km`);
    
    const distanceError = rFinal.distanceTo(r2);
    console.log(`  Distance Error: ${distanceError.toFixed(6)} km`);
    console.log(`  Relative Error: ${(distanceError / r2Mag * 100).toFixed(6)}%\n`);
    
    // Use a tolerance based on orbit size (0.1% of target radius)
    const tolerance = r2Mag * 0.001;
    if (distanceError < tolerance) {
        console.log(`✅ SUCCESS: Lambert solver result is correct (error < ${tolerance.toFixed(2)} km)`);
    } else {
        console.error(`❌ FAILED: Lambert solver result is incorrect (error > ${tolerance.toFixed(2)} km)`);
    }
}

testLambert();
