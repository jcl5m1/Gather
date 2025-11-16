/**
 * Test file demonstrating command-based interface usage
 * This can be used for automated testing without UI rendering
 */

import { GameLoop } from './gameLoop';
import { SimulationController } from './simulationController';

// Example: Test the command interface without UI
export function testCommandInterface(): void {
    // Create game loop (without rendering if needed)
    const gameLoop = new GameLoop();
    const controller = new SimulationController(gameLoop);

    console.log('=== Testing Command Interface ===\n');

    // Test 1: Help command
    console.log('Test 1: HELP command');
    const helpResult = controller.executeCommand('HELP');
    console.log('Result:', helpResult);
    console.log('');

    // Test 2: Reset simulation
    console.log('Test 2: RESET command');
    const resetResult = controller.executeCommand('RESET position:20,5,3 velocity:2,8.5,0 mass:1.0 bodyId:default');
    console.log('Result:', resetResult);
    console.log('');

    // Test 3: Get orbit info
    console.log('Test 3: GET_ORBIT_INFO command');
    const orbitResult = controller.executeCommand('GET_ORBIT_INFO default');
    console.log('Result:', orbitResult);
    console.log('');

    // Test 4: Set time scale
    console.log('Test 4: SET_TIME_SCALE command');
    const timeScaleResult = controller.executeCommand('SET_TIME_SCALE 100');
    console.log('Result:', timeScaleResult);
    console.log('');

    // Test 5: Get state
    console.log('Test 5: GET_STATE command');
    const stateResult = controller.executeCommand('GET_STATE default');
    console.log('Result:', stateResult);
    console.log('');

    // Test 6: List bodies
    console.log('Test 6: LIST_BODIES command');
    const listResult = controller.executeCommand('LIST_BODIES');
    console.log('Result:', listResult);
    console.log('');

    // Test 7: Add another body
    console.log('Test 7: ADD_BODY command');
    const addResult = controller.executeCommand('ADD_BODY position:30,0,0 velocity:0,6,0 mass:0.5 id:body2');
    console.log('Result:', addResult);
    console.log('');

    // Test 8: List bodies again
    console.log('Test 8: LIST_BODIES after adding body');
    const listResult2 = controller.executeCommand('LIST_BODIES');
    console.log('Result:', listResult2);
    console.log('');

    console.log('=== All Tests Complete ===');
}

// Export for use in browser console or tests
if (typeof window !== 'undefined') {
    (window as any).testCommandInterface = testCommandInterface;
}

