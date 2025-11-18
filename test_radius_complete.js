// Comprehensive test for radius updates
// Paste this into browser console at http://localhost:8000

console.log("=== Radius Update Test ===\n");

const controller = window.simulationController;

// Step 1: Check Moon's initial state
console.log("1. Checking Moon's initial radius...");
const moon = controller.getBody('Moon');
if (moon) {
    console.log(`   Moon radius: ${moon.getRadius()} km`);
    console.log(`   Moon mesh radius: ${moon.getMesh().geometry.parameters.radius} km`);
}

// Step 2: Focus on Moon
console.log("\n2. Focusing camera on Moon...");
controller.executeCommand('SET_CAMERA_FOCUS Moon');

// Step 3: Test via command line
console.log("\n3. Testing RESET command with new radius (2000 km)...");
const initialRadius = moon.getRadius();
controller.executeCommand('RESET position:' + moon.getInitialPosition().x + ',' + moon.getInitialPosition().y + ',' + moon.getInitialPosition().z + ' velocity:' + moon.getInitialVelocity().x + ',' + moon.getInitialVelocity().y + ',' + moon.getInitialVelocity().z + ' mass:' + moon.getMass() + ' radius:2000 bodyId:Moon');

setTimeout(() => {
    const newRadius = moon.getRadius();
    const meshRadius = moon.getMesh().geometry.parameters.radius;
    
    console.log(`   Old radius: ${initialRadius} km`);
    console.log(`   New radius: ${newRadius} km`);
    console.log(`   Mesh radius: ${meshRadius} km`);
    
    if (newRadius === 2000 && meshRadius === 2000) {
        console.log("   ✓ Command-based update: SUCCESS");
    } else {
        console.log("   ✗ Command-based update: FAILED");
    }
    
    // Step 4: Test UI input
    console.log("\n4. Instructions for UI test:");
    console.log("   a) Look at the Property Inspector on the left");
    console.log("   b) Find the 'OrbitalBody' section (should be expanded)");
    console.log("   c) Find the 'Radius' field");
    console.log("   d) Change it to 5000 and press Enter");
    console.log("   e) Watch the Moon sphere grow to 5000 km radius!");
    console.log("   f) Run the following command to verify:");
    console.log("      console.log('Moon radius:', moon.getRadius(), 'Mesh radius:', moon.getMesh().geometry.parameters.radius)");
    
}, 200);
