// Test script to verify radius updates work visually
// Run this in the browser console after loading http://localhost:8000

console.log("=== Visual Radius Update Test ===\n");

const controller = window.simulationController;

// Test 1: Add a body with a very small radius
console.log("1. Adding body with radius 10 km (should be tiny)...");
controller.executeCommand('ADD_BODY position:100000,0,0 velocity:0,3,0 mass:1e20 radius:10 id:SmallBody');
controller.executeCommand('SET_CAMERA_FOCUS SmallBody');

setTimeout(() => {
    const body = controller.getBody('SmallBody');
    console.log(`   Current radius: ${body.getRadius()} km`);
    console.log(`   Mesh radius: ${body.getMesh().geometry.parameters.radius} km`);
    
    // Test 2: Update to a much larger radius
    console.log("\n2. Updating to radius 5000 km (should be much larger)...");
    controller.executeCommand('RESET position:100000,0,0 velocity:0,3,0 mass:1e20 radius:5000 bodyId:SmallBody');
    
    setTimeout(() => {
        console.log(`   New radius: ${body.getRadius()} km`);
        console.log(`   New mesh radius: ${body.getMesh().geometry.parameters.radius} km`);
        
        if (body.getRadius() === 5000 && body.getMesh().geometry.parameters.radius === 5000) {
            console.log("\n✓ SUCCESS: Radius updated from 10 to 5000 km!");
            console.log("   Look at the 3D view - the body should now be 500x larger!");
        } else {
            console.log("\n✗ FAILURE: Radius did not update correctly");
        }
        
        // Test 3: Test UI input changes
        console.log("\n3. Test UI Inspector:");
        console.log("   - The body 'SmallBody' is now focused");
        console.log("   - In the left panel 'OrbitalBody' section, find the 'Radius' field");
        console.log("   - Change it to a different value (e.g., 1000) and press Enter");
        console.log("   - Watch the sphere in the 3D view change size immediately!");
    }, 100);
}, 100);
