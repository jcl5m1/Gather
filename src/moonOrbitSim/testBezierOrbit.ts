// Auto-run test for rational Bezier orbit accuracy
// This file will automatically test the Moon orbit when loaded

import { testAndLogRationalBezierOrbit } from './rationalBezierOrbit';
import * as THREE from 'three';

// Function to run the test after a short delay to ensure simulation is loaded
export function autoRunBezierTest() {
    setTimeout(() => {
        console.log('');
        console.log('========================================');
        console.log('AUTO-RUNNING BEZIER ORBIT ACCURACY TEST');
        console.log('========================================');
        console.log('');
        
        // Test Moon orbit parameters
        const a = 221273.57; // km
        const e = 0.737;
        const periapsisDir = new THREE.Vector3(1, 0, 0);
        const perpDir = new THREE.Vector3(0, 1, 0);
        
        testAndLogRationalBezierOrbit(a, e, periapsisDir, perpDir, 25);
        
        console.log('');
        console.log('========================================');
        console.log('TEST COMPLETE');
        console.log('========================================');
        console.log('');
    }, 2000); // Wait 2 seconds for simulation to fully initialize
}
