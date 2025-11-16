# Command Interface Documentation

The simulation now uses a text-based command interface that allows all UI interactions to be tested and automated without rendering or UI interaction.

## Architecture

1. **CommandProcessor** (`commandProcessor.ts`): Parses and executes text commands
2. **SimulationController** (`simulationController.ts`): Wraps CommandProcessor and provides command history
3. **UIManager** (`uiManager.ts`): Sends commands instead of directly calling methods
4. **Global Access**: Controller is exposed as `window.simulationController` for browser console testing

## Available Commands

### RESET
Reset simulation with new parameters.

**Usage:**
```
RESET position:x,y,z velocity:x,y,z mass:value [bodyId:id]
```

**Example:**
```
RESET position:20,5,3 velocity:2,8.5,0 mass:1.0 bodyId:default
```

**Response:**
```json
{
  "success": true,
  "message": "Reset body 'default' with new parameters",
  "data": {
    "bodyId": "default",
    "position": [20, 5, 3],
    "velocity": [2, 8.5, 0],
    "mass": 1.0,
    "orbitType": "elliptical",
    "orbitParameters": {
      "a": 49.32,
      "e": 0.764,
      "periapsis": 11.64,
      "apoapsis": 87.01
    }
  }
}
```

### SET_TIME_SCALE
Set simulation time scale.

**Usage:**
```
SET_TIME_SCALE <value>
```

**Example:**
```
SET_TIME_SCALE 100
```

### GET_ORBIT_INFO
Get orbit information for a body.

**Usage:**
```
GET_ORBIT_INFO [bodyId]
```

**Example:**
```
GET_ORBIT_INFO default
```

**Response:**
```json
{
  "success": true,
  "data": {
    "bodyId": "default",
    "orbitType": "elliptical",
    "parameters": {
      "a": 49.32,
      "e": 0.764,
      "periapsis": 11.64,
      "apoapsis": 87.01,
      "period": 84.67
    }
  }
}
```

### GET_STATE
Get current state of a body.

**Usage:**
```
GET_STATE [bodyId]
```

**Example:**
```
GET_STATE default
```

**Response:**
```json
{
  "success": true,
  "data": {
    "bodyId": "default",
    "position": [20, 5, 3],
    "velocity": [2, 8.5, 0],
    "mass": 1.0,
    "trailPoints": 1
  }
}
```

### ADD_BODY
Add a new orbital body.

**Usage:**
```
ADD_BODY [position:x,y,z] [velocity:x,y,z] [mass:value] [id:id] [radius:value] [color:hex] [trajectoryColor:hex]
```

**Example:**
```
ADD_BODY position:30,0,0 velocity:0,6,0 mass:0.5 id:body2 radius:0.8 color:ff00ff trajectoryColor:ff00ff
```

### REMOVE_BODY
Remove an orbital body.

**Usage:**
```
REMOVE_BODY <bodyId>
```

**Example:**
```
REMOVE_BODY body2
```

### LIST_BODIES
List all orbital body IDs.

**Usage:**
```
LIST_BODIES
```

**Response:**
```json
{
  "success": true,
  "data": {
    "bodies": ["default", "body2"]
  }
}
```

### START
Start the simulation.

**Usage:**
```
START
```

### STOP
Stop the simulation.

**Usage:**
```
STOP
```

### HELP
Show help message with all available commands.

**Usage:**
```
HELP
```

## Testing Without UI

### Browser Console

The controller is exposed globally as `window.simulationController`:

```javascript
// Execute a command
const result = window.simulationController.executeCommand('RESET position:20,5,3 velocity:2,8.5,0 mass:1.0');

// Check result
console.log(result.success); // true/false
console.log(result.message);  // Status message
console.log(result.data);     // Response data

// Get command history
const history = window.simulationController.getCommandHistory();

// Convenience methods
window.simulationController.reset({x: 20, y: 5, z: 3}, {x: 2, y: 8.5, z: 0}, 1.0);
window.simulationController.setTimeScale(100);
window.simulationController.getOrbitInfo('default');
window.simulationController.getState('default');
```

### Automated Testing

You can create test scripts that use the command interface:

```typescript
import { GameLoop } from './gameLoop';
import { SimulationController } from './simulationController';

function runTests() {
    const gameLoop = new GameLoop();
    const controller = new SimulationController(gameLoop);
    
    // Test 1: Reset
    const resetResult = controller.executeCommand('RESET position:20,5,3 velocity:2,8.5,0 mass:1.0');
    console.assert(resetResult.success, 'Reset should succeed');
    
    // Test 2: Get orbit info
    const orbitResult = controller.executeCommand('GET_ORBIT_INFO default');
    console.assert(orbitResult.success, 'Get orbit info should succeed');
    console.assert(orbitResult.data.orbitType === 'elliptical', 'Orbit should be elliptical');
    
    // Test 3: Set time scale
    const timeScaleResult = controller.executeCommand('SET_TIME_SCALE 100');
    console.assert(timeScaleResult.success, 'Set time scale should succeed');
}
```

### UI Command Interface

The UI includes a command input field that allows testing commands directly:

1. Open the simulation in a browser
2. Find the "Command Interface (for testing)" section
3. Type a command (e.g., `RESET position:25,5,3 velocity:2,7.5,0 mass:1.0`)
4. Click "Execute" or press Enter
5. View the result in the output area below

## Benefits

1. **Testable**: All simulation operations can be tested programmatically
2. **Automated**: Commands can be scripted for automated testing
3. **Debuggable**: Command history helps track what operations were performed
4. **Decoupled**: UI is decoupled from simulation logic
5. **No Rendering Required**: Commands can be executed without UI rendering for headless testing

