
import * as THREE from 'three';
import { TransferCalculator } from './transferCalculator';

/**
 * Test for Lambert Solver using known variables.
 */
function testLambert() {
    console.log("Running Lambert Solver Test...");

    // Earth gravitational parameter (km^3/s^2)
    const mu = 398600.4418;

    // Initial position (km)
    const r1 = new THREE.Vector3(5000, 10000, 2100);
    // Final position (km)
    const r2 = new THREE.Vector3(-14600, 2500, 7000);
    // Time of flight (s) - using 4000s for short-way case
    const dt = 4000;

    console.log(`Inputs:`);
    console.log(`  r1: [${r1.x}, ${r1.y}, ${r1.z}] km`);
    console.log(`  r2: [${r2.x}, ${r2.y}, ${r2.z}] km`);
    console.log(`  dt: ${dt} s`);
    console.log(`  mu: ${mu} km^3/s^2`);

    const result = TransferCalculator.solveLambert(r1, r2, dt, mu, true);

    if (!result) {
        console.error("FAILED: Lambert solver returned null");
        return;
    }

    console.log(`Results:`);
    console.log(`  v1: [${result.v1.x.toFixed(4)}, ${result.v1.y.toFixed(4)}, ${result.v1.z.toFixed(4)}] km/s`);
    console.log(`  v2: [${result.v2.x.toFixed(4)}, ${result.v2.y.toFixed(4)}, ${result.v2.z.toFixed(4)}] km/s`);

    const v1Mag = result.v1.length();
    console.log(`  v1 magnitude: ${v1Mag.toFixed(6)} km/s`);

    // --- VERIFICATION via manual propagation ---
    console.log("\nVerifying Solution via Propagation...");
    
    const h = new THREE.Vector3().crossVectors(r1, result.v1);
    const hMag = h.length();
    const r1Mag = r1.length();
    const v1MagSq = result.v1.lengthSq();
    const energy = v1MagSq / 2 - mu / r1Mag;
    const a = -mu / (2 * energy);
    const e = Math.sqrt(Math.abs(1 + (2 * energy * hMag * hMag) / (mu * mu)));
    const period = 2 * Math.PI * Math.sqrt(Math.pow(Math.abs(a), 3) / mu);

    console.log(`  Derived Orbit:`);
    console.log(`    a: ${a.toFixed(2)} km`);
    console.log(`    e: ${e.toFixed(6)}`);
    console.log(`    T: ${period.toFixed(2)} s`);

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
        
    console.log(`\nPropagation Result at t=${dt}s:`);
    console.log(`  r_final: [${rFinal.x.toFixed(2)}, ${rFinal.y.toFixed(2)}, ${rFinal.z.toFixed(2)}] km`);
    console.log(`  r_target: [${r2.x.toFixed(2)}, ${r2.y.toFixed(2)}, ${r2.z.toFixed(2)}] km`);
    
    const distanceError = rFinal.distanceTo(r2);
    console.log(`  Distance Error: ${distanceError.toFixed(6)} km`);
    
    if (distanceError < 10.0) { // 10km tolerance for Earth-scale orbit
        console.log("\n✅ SUCCESS: Lambert solver result is correct.");
    } else {
        console.error("\n❌ FAILED: Lambert solver result is incorrect!");
    }
}

testLambert();
