// Test script to verify radius updates work correctly
// Run this in the browser console after loading the simulation

console.log("=== Testing Radius Update Functionality ===\n");

// Get the simulation controller from the window
const controller = window.simulationController;

console.log("1. Adding test body with radius 50...");
const addResult = controller.executeCommand('ADD_BODY position:100000,0,0 velocity:0,3,0 mass:1e20 radius:50 id:RadiusTestBody');
console.log(addResult.success ? "✓ Body added successfully" : "✗ Failed to add body: " + addResult.message);

console.log("\n2. Focusing camera on test body...");
const focusResult = controller.executeCommand('SET_CAMERA_FOCUS RadiusTestBody');
console.log(focusResult.success ? "✓ Camera focused" : "✗ Failed to focus: " + focusResult.message);

// Get the body to inspect its radius
const body = controller.getBody('RadiusTestBody');
if (body) {
    console.log("\n3. Initial radius: " + body.getRadius());
    console.log("   Initial mesh geometry radius: " + body.getMesh().geometry.parameters.radius);
    
    console.log("\n4. Updating radius to 150 using RESET command...");
    const resetResult = controller.executeCommand('RESET position:100000,0,0 velocity:0,3,0 mass:1e20 radius:150 bodyId:RadiusTestBody');
    console.log(resetResult.success ? "✓ Body reset with new radius" : "✗ Failed to reset: " + resetResult.message);
    
    console.log("\n5. New radius: " + body.getRadius());
    console.log("   New mesh geometry radius: " + body.getMesh().geometry.parameters.radius);
    
    // Verify the radius actually changed
    if (body.getRadius() === 150 && body.getMesh().geometry.parameters.radius === 150) {
        console.log("\n✓✓✓ SUCCESS: Radius update works correctly! ✓✓✓");
        console.log("The body radius and mesh geometry have both been updated to 150 km.");
    } else {
        console.log("\n✗✗✗ FAILURE: Radius did not update correctly ✗✗✗");
        console.log("Expected radius: 150, Got: " + body.getRadius());
        console.log("Expected mesh radius: 150, Got: " + body.getMesh().geometry.parameters.radius);
    }
} else {
    console.log("\n✗ Could not find body to test");
}

console.log("\n6. Testing UI input changes...");
console.log("   In the inspector, you should see a 'Radius' field under the OrbitalBody section.");
console.log("   Change the radius value and observe the visual change in the 3D view.");
console.log("   The mesh should regenerate with the new radius size.");
