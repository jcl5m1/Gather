const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

// Execute the worker code in a clean context to extract its functions
const workerCode = fs.readFileSync(__dirname + '/threebody_worker.js', 'utf8');

const sandbox = {
    self: {},
    console: console,
    postMessage: () => {},
    Math: Math,
    Float64Array: Float64Array,
    Array: Array,
    Map: Map,
    isNaN: isNaN,
    setTimeout: setTimeout,
    Promise: Promise
};
vm.createContext(sandbox);

// Convert top-level 'const' and 'let' to 'var' so they bind to the sandbox global object
// This allows us to access DIST_UNIT, VEL_UNIT, etc., directly from 'sandbox'
const patchedCode = workerCode.replace(/^(const|let)\s+/gm, 'var ');
vm.runInContext(patchedCode, sandbox);

async function runUnitTest() {
    console.log("==================================================");
    console.log("   PERIODIC ORBIT OPTIMIZER UNIT TEST SUITE");
    console.log("==================================================\n");

    const init_state = {
        x: -0.010325095451556132,
        y: 0.36969497528799133,
        vx: -1.0871450844628807,
        vy: -0.8382805470557153
    };

    console.log("[1] Running Initial Dry Evaluation...");
    const evaluateAll = await sandbox.findGeneralPeriodicOrbit(init_state, 8, true);
    assert(evaluateAll && evaluateAll.crossings, "Dry run should return populated crossings array");
    console.log(`    Successfully generated ${evaluateAll.crossings.length} initial crossings on the section.\n`);

    const use_y_sec = Math.abs(init_state.vy) > Math.abs(init_state.vx);
    const mapNorm = 50000 / sandbox.DIST_UNIT;
    const velNorm = 1.5 / sandbox.VEL_UNIT;

    let attempts = [];
    evaluateAll.crossings.forEach((c, idx) => {
        let err;
        if (use_y_sec) {
            const diffX = (c.x - init_state.x) / mapNorm;
            const diffVx = (c.vx - init_state.vx) / velNorm;
            err = Math.sqrt(diffX*diffX + diffVx*diffVx);
        } else {
            const diffY = (c.y - init_state.y) / mapNorm;
            const diffVy = (c.vy - init_state.vy) / velNorm;
            err = Math.sqrt(diffY*diffY + diffVy*diffVy);
        }
        attempts.push({ k: idx + 1, err, state: c });
    });
    
    attempts.sort((a,b) => a.err - b.err);
    console.log("[2] Sorting Initial Guesses By Scaled Mismatch Proximity:");
    for (const opt of attempts) {
        console.log(`    - k=${opt.k} Orbit Resilience : Mismatch = ${opt.err.toFixed(4)}`);
    }
    
    // Test the top candidate to see if the numerical solver converges
    const topCandidate = attempts[0];
    console.log(`\n[3] Testing Top Resonance Candidate (k=${topCandidate.k})...`);
    
    const result = await sandbox.findGeneralPeriodicOrbit(topCandidate.state, topCandidate.k, false, (iter, distKm, velMs) => {
         console.log(`    [Iter ${iter.toString().padStart(2)}] Correction Mismatch: Δr=${distKm.toFixed(1)}km, Δv=${velMs.toFixed(1)}m/s`);
    });
    
    if (result && result.state) {
        console.log("\n✅ SUCCESS: Optimizer successfully converged mathematically!");
        console.log("    Converged Vector:");
        console.dir(result.state);
    } else {
        console.log("\n❌ FAILED: Optimizer failed to converge.");
        console.log("   Reason:", result ? result.error : "Unknown");
        assert.fail("Numerical optimizer did not converge on provided target condition.");
    }
}

try {
    runUnitTest();
} catch (e) {
    console.error("Test Suite Failed:", e.message);
    process.exit(1);
}
