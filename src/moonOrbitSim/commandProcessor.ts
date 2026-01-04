import * as THREE from 'three';
import { GameLoop } from './gameLoop';
import { OrbitalBody } from './orbitalBody';
import { generateStateFromOrbitalElements } from './orbitUtils';
import { G, config } from './config';
import { kilograms, kilometers, seconds, gravitationalConstantUnit } from './units';

export interface CommandResult {
    success: boolean;
    message?: string;
    data?: any;
}

/**
 * Command processor that handles text-based commands for controlling the simulation
 * This allows the simulation to be controlled and tested without UI interaction
 */
export class CommandProcessor {
    private gameLoop: GameLoop;
    private orbitalBodyIdMap: Map<string, OrbitalBody> = new Map();
    private nextBodyId: number = 1;
    private initializeSimulationCallback?: () => void;

    constructor(gameLoop: GameLoop) {
        this.gameLoop = gameLoop;
    }

    /**
     * Set the callback for initializing the simulation (called by RESET command)
     */
    setInitializeSimulationCallback(callback: () => void): void {
        this.initializeSimulationCallback = callback;
    }

    /**
     * Clear all bodies from the command processor's tracking map
     * This should be called when resetting the simulation
     */
    clearAllBodies(): void {
        this.orbitalBodyIdMap.clear();
        this.nextBodyId = 1; // Reset the body ID counter
    }

    /**
     * Process a text command and return the result
     * @param command - Text command string (e.g., "RESET position:15,5,3 velocity:2,10,0 mass:1.0")
     * @returns CommandResult with success status and optional message/data
     */
    processCommand(command: string): CommandResult {
        const parts = command.trim().split(/\s+/);
        const cmd = parts[0].toUpperCase();

        try {
            switch (cmd) {
                case 'RESET':
                    return this.handleReset(parts.slice(1));
                
                case 'RESET_ALL':
                    return this.handleResetAll();
                
                case 'SET_TIME_SCALE':
                case 'TIMESCALE':
                    return this.handleTimeScale(parts.slice(1));
                
                case 'GET_ORBIT_INFO':
                case 'ORBIT_INFO':
                    return this.handleGetOrbitInfo(parts.slice(1));
                
                case 'GET_STATE':
                case 'STATE':
                    return this.handleGetState(parts.slice(1));
                
                case 'ADD_BODY':
                    return this.handleAddBody(parts.slice(1));
                
                case 'REMOVE_BODY':
                    return this.handleRemoveBody(parts.slice(1));
                
                case 'LIST_BODIES':
                    return this.handleListBodies();
                
                case 'SET_CAMERA_FOCUS':
                case 'CAMERA_FOCUS':
                    return this.handleSetCameraFocus(parts.slice(1));
                
                case 'START':
                    return this.handleStart();
                
                case 'STOP':
                    return this.handleStop();
                
                case 'HELP':
                    return this.handleHelp();
                
                default:
                    return {
                        success: false,
                        message: `Unknown command: ${cmd}. Type 'HELP' for available commands.`
                    };
            }
        } catch (error) {
            return {
                success: false,
                message: `Error executing command: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    private handleReset(args: string[]): CommandResult {
        // If no arguments provided, reset to initial state (like page refresh)
        if (args.length === 0) {
            return this.handleResetToInitial();
        }

        const params = this.parseKeyValuePairs(args);
        
        const position = this.parseVector3(params.position || '15,5,3');
        const velocity = this.parseVector3(params.velocity || '2,10,0');
        const mass = parseFloat(params.mass || '1.0');
        const radius = params.radius ? parseFloat(params.radius) : undefined;
        const bodyId = params.bodyid || params.bodyId || 'default';

        if (!position || !velocity || isNaN(mass)) {
            return {
                success: false,
                message: 'Invalid parameters. Expected: position:x,y,z velocity:x,y,z mass:value [radius:value] [bodyId:id]'
            };
        }

        // Get or create the body
        let body = this.orbitalBodyIdMap.get(bodyId);
        if (!body) {
            body = this.gameLoop.addOrbitalBody(
                position,
                velocity,
                mass,
                radius !== undefined ? radius : 1.0,
                0xff6666,
                0xff6666,
                bodyId
            );
            this.orbitalBodyIdMap.set(bodyId, body);
        } else {
            this.gameLoop.resetOrbitalBody(body, position, velocity, mass, radius);
        }

        const trajectory = body.getTrajectory();
        const params_data = trajectory.getParameters();

        // Extract numeric values from Measure types
        const aValue = params_data._a.over(kilometers).value;
        const periodValue = params_data.period.over(seconds).value;

        return {
            success: true,
            message: `Reset body '${bodyId}' with new parameters`,
            data: {
                bodyId,
                position: position.toArray(),
                velocity: velocity.toArray(),
                mass,
                orbitType: trajectory.getType(),
                orbitParameters: {
                    a: aValue,
                    e: params_data.e,
                    periapsis: aValue * (1 - params_data.e),
                    apoapsis: aValue * (1 + params_data.e),
                    period: periodValue
                }
            }
        };
    }

    private handleResetToInitial(): CommandResult {
        console.log('[CommandProcessor] RESET command called (no parameters) - performing full reset');
        
        if (!this.initializeSimulationCallback) {
            console.error('[CommandProcessor] ERROR: Initialize simulation callback not set');
            return {
                success: false,
                message: 'Initialize simulation callback not set. Cannot perform full reset.'
            };
        }
        
        // Call the initialization method (same as page load)
        // This will:
        // - Clear the command processor's body map
        // - Remove all bodies from the game loop
        // - Reset time scale, time, and camera
        // - Re-add the Moon
        // The Moon will be added to orbitalBodyIdMap automatically via ADD_BODY command
        this.initializeSimulationCallback();
        
        // Get the Moon body name for the response
        const moonConfig = config.bodies.moon;
        
        console.log('[CommandProcessor] RESET complete');
        
        return {
            success: true,
            message: 'Reset simulation to initial state (same as page refresh)',
            data: {
                timeScale: config.physics.defaultTimeScale,
                currentTime: 0,
                bodies: [moonConfig.name]
            }
        };
    }

    private handleResetAll(): CommandResult {
        this.gameLoop.resetAll();
        return {
            success: true,
            message: 'Reset all simulation parameters and all orbital bodies to initial conditions',
            data: { 
                timeScale: this.gameLoop.getTimeScale(),
                currentTime: this.gameLoop.getCurrentTime()
            }
        };
    }

    private handleTimeScale(args: string[]): CommandResult {
        if (args.length === 0) {
            return {
                success: false,
                message: 'Missing time scale value. Usage: SET_TIME_SCALE <value>'
            };
        }

        const scale = parseFloat(args[0]);
        if (isNaN(scale) || scale < 0) {
            return {
                success: false,
                message: 'Invalid time scale. Must be a positive number.'
            };
        }

        this.gameLoop.setTimeScale(scale);
        return {
            success: true,
            message: `Time scale set to ${scale}x`,
            data: { timeScale: scale }
        };
    }

    private handleGetOrbitInfo(args: string[]): CommandResult {
        const bodyId = args[0] || 'default';
        const body = this.orbitalBodyIdMap.get(bodyId);

        if (!body) {
            return {
                success: false,
                message: `Body '${bodyId}' not found. Use LIST_BODIES to see available bodies.`
            };
        }

        const trajectory = body.getTrajectory();
        const params = trajectory.getParameters();

        return {
            success: true,
            data: {
                bodyId,
                orbitType: trajectory.getType(),
                parameters: {
                    a: params._a.over(kilometers).value,
                    e: params.e,
                    periapsis: params._a.over(kilometers).value * (1 - params.e),
                    apoapsis: params._a.over(kilometers).value * (1 + params.e),
                    period: params.period.over(seconds).value
                }
            }
        };
    }

    private handleGetState(args: string[]): CommandResult {
        const bodyId = args[0] || 'default';
        const body = this.orbitalBodyIdMap.get(bodyId);

        if (!body) {
            return {
                success: false,
                message: `Body '${bodyId}' not found. Use LIST_BODIES to see available bodies.`
            };
        }

        return {
            success: true,
            data: {
                bodyId,
                position: body.getPosition().toArray(),
                velocity: body.getVelocity().toArray(),
                initialPosition: body.getInitialPosition().toArray(),
                initialVelocity: body.getInitialVelocity().toArray(),
                mass: body.getMass(),
                trailPoints: body.getTrailPoints().length
            }
        };
    }

    /**
     * Compute orbit parameters from position and velocity
     */
    private computeOrbitParameters(position: THREE.Vector3, velocity: THREE.Vector3, centralBodyMass: number): { a: number; e: number; periapsis: number; apoapsis: number; type: string } | null {
        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;
        const r = position.length();
        const v = velocity.length();

        // Calculate orbit geometry vectors
        const hVec = new THREE.Vector3().crossVectors(position, velocity);
        const vCrossH = new THREE.Vector3().crossVectors(velocity, hVec);
        const eVec = vCrossH.multiplyScalar(1 / mu).sub(position.clone().normalize());
        const e = eVec.length();

        // Calculate orbital elements
        const specificEnergy = (v * v / 2) - (mu / r);
        
        // Only handle elliptical orbits (bound orbits)
        if (specificEnergy >= 0) {
            return null; // Hyperbolic or parabolic, not valid for our requirements
        }

        const a = -mu / (2 * specificEnergy);
        const periapsis = a * (1 - e);
        const apoapsis = a * (1 + e);

        return {
            a,
            e,
            periapsis,
            apoapsis,
            type: 'elliptical'
        };
    }

    private handleAddBody(args: string[]): CommandResult {
        const params = this.parseKeyValuePairs(args);
        
        // Check if any parameters were provided
        const hasParams = args.length > 0 && Object.keys(params).length > 0;
        
        let position: THREE.Vector3 | null = null;
        let velocity: THREE.Vector3 | null = null;
        let mass: number = 0;
        let radius: number = 0;
        let color: number = 0;
        let trajectoryColor: number = 0;
        let bodyId: string = '';
        let randomValues: any = null;

        if (!hasParams || !params.position || !params.velocity || !params.mass) {
            // Generate random position and velocity, then compute orbit parameters
            // Keep trying until we get valid orbit parameters
            const centralMass = config.bodies.earth.mass;
            let validOrbit = false;
            let attempts = 0;
            const maxAttempts = 1000;
            
            // Generate random color (same for all attempts)
            const hue = Math.random() * 360;
            const colorObj = new THREE.Color().setHSL(hue / 360, 0.7, 0.5);
            const colorHex = colorObj.getHexString();
            const trajectoryColorObj = new THREE.Color().setHSL(hue / 360, 0.5, 0.7);
            const trajectoryColorHex = trajectoryColorObj.getHexString();
            
            // Small mass and radius for the body
            mass = 1e10; // Small mass in kg
            radius = 10; // 10 km radius
            color = parseInt(colorHex, 16);
            trajectoryColor = parseInt(trajectoryColorHex, 16);
            bodyId = params.id || `RandomBody_${this.nextBodyId++}`;
            
            while (!validOrbit && attempts < maxAttempts) {
                attempts++;
                
                // Generate random position (distance from origin)
                // Try distances between 50km and 500000km
                const distance = 50 + Math.random() * (500000 - 50);
                const theta = Math.random() * 2 * Math.PI; // Azimuth angle
                const phi = Math.acos(2 * Math.random() - 1); // Polar angle (uniform distribution on sphere)
                
                position = new THREE.Vector3(
                    distance * Math.sin(phi) * Math.cos(theta),
                    distance * Math.sin(phi) * Math.sin(theta),
                    distance * Math.cos(phi)
                );
                
                // Generate random velocity
                // Velocity magnitude should be reasonable for orbit (not too fast, not too slow)
                // For circular orbit at distance r: v = sqrt(G*M/r)
                // Use a range around this
                const GValue = (G as any).over(gravitationalConstantUnit).value;
                const circularVel = Math.sqrt(GValue * centralMass / distance);
                const velMagnitude = circularVel * (0.5 + Math.random() * 1.5); // 0.5x to 2x circular velocity
                
                const velTheta = Math.random() * 2 * Math.PI;
                const velPhi = Math.acos(2 * Math.random() - 1);
                
                velocity = new THREE.Vector3(
                    velMagnitude * Math.sin(velPhi) * Math.cos(velTheta),
                    velMagnitude * Math.sin(velPhi) * Math.sin(velTheta),
                    velMagnitude * Math.cos(velPhi)
                );
                
                // Compute orbit parameters from position and velocity
                const orbitParams = this.computeOrbitParameters(position, velocity, centralMass);
                
                if (orbitParams && orbitParams.type === 'elliptical') {
                    // Check if orbit meets requirements:
                    // - Eccentricity between 0.2 and 0.8
                    // - Periapsis > 50km
                    // - Apoapsis < 500000km
                    if (orbitParams.e >= 0.2 && orbitParams.e <= 0.8 &&
                        orbitParams.periapsis > 50 &&
                        orbitParams.apoapsis < 500000) {
                        validOrbit = true;
                        
                        // Store random values for output
                        randomValues = {
                            position: `${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)}`,
                            velocity: `${velocity.x.toFixed(4)},${velocity.y.toFixed(4)},${velocity.z.toFixed(4)}`,
                            mass: mass.toExponential(1),
                            radius: radius.toFixed(1),
                            color: `#${colorHex}`,
                            trajectoryColor: `#${trajectoryColorHex}`,
                            attempts: attempts
                        };
                    }
                }
            }
            
            if (!validOrbit) {
                return {
                    success: false,
                    message: `Failed to generate valid orbit after ${maxAttempts} attempts. Requirements: eccentricity 0.2-0.8, periapsis >50km, apoapsis <500000km.`
                };
            }
        } else {
            // Use provided parameters
            position = this.parseVector3(params.position);
            velocity = this.parseVector3(params.velocity);
            mass = parseFloat(params.mass);
            bodyId = params.id || `body_${this.nextBodyId++}`;
            radius = parseFloat(params.radius || '1.0');
            color = params.color ? parseInt(params.color, 16) : 0xff6666;
            trajectoryColor = params.trajectoryColor ? parseInt(params.trajectoryColor, 16) : 0xff6666;
        }

        if (!position || !velocity || isNaN(mass)) {
            return {
                success: false,
                message: 'Invalid parameters. Expected: position:x,y,z velocity:x,y,z mass:value [id:id] [radius:value] [color:hex] [trajectoryColor:hex] [parentId:id]'
            };
        }

        if (this.orbitalBodyIdMap.has(bodyId)) {
            return {
                success: false,
                message: `Body with id '${bodyId}' already exists. Use REMOVE_BODY first or use a different id.`
            };
        }

        // Get parentId if provided
        const parentId = params.parentid || params.parentId || '';

        const body = this.gameLoop.addOrbitalBody(
            position,
            velocity,
            mass,
            radius,
            color,
            trajectoryColor,
            bodyId,
            parentId
        );
        // Add to map immediately so it's available when camera switches to it
        this.orbitalBodyIdMap.set(bodyId, body);

        // Get computed orbit parameters
        const trajectory = body.getTrajectory();
        const orbitParams = trajectory.getParameters();
        const orbitType = trajectory.getType();
        
        // Extract numeric values from Measure types
        const aValue = orbitParams._a.over(kilometers).value;
        const periodValue = orbitParams.period.over(seconds).value;
        const computedPeriapsis = aValue * (1 - orbitParams.e);
        const computedApoapsis = aValue * (1 + orbitParams.e);

        // Build message with random values if they were generated
        let message = `Added body '${bodyId}'`;
        if (randomValues) {
            message += `\n\nRandom position/velocity: position=(${randomValues.position})km, velocity=(${randomValues.velocity})km/s\nmass=${randomValues.mass}kg, radius=${randomValues.radius}km, color=${randomValues.color}`;
            if (randomValues.attempts) {
                message += ` (generated in ${randomValues.attempts} attempt${randomValues.attempts > 1 ? 's' : ''})`;
            }
        }

        // Add computed orbit parameters (these are the actual orbit parameters from the generated position/velocity)
        message += `\n\nComputed orbit: type=${orbitType}, semi-major axis=${aValue.toFixed(2)}km, eccentricity=${orbitParams.e.toFixed(3)}\nperiapsis=${computedPeriapsis.toFixed(2)}km, apoapsis=${computedApoapsis.toFixed(2)}km`;
        if (periodValue !== undefined && periodValue !== null && isFinite(periodValue)) {
            message += `, period=${periodValue.toFixed(2)}s`;
        }
        
        // Verify orbit meets requirements
        if (randomValues) {
            const meetsEccentricity = orbitParams.e >= 0.2 && orbitParams.e <= 0.8;
            const meetsPeriapsis = computedPeriapsis > 50;
            const meetsApoapsis = computedApoapsis < 500000;
            if (meetsEccentricity && meetsPeriapsis && meetsApoapsis) {
                message += `\n\n✓ Orbit meets requirements: e=${orbitParams.e.toFixed(3)} (0.2-0.8), rp=${computedPeriapsis.toFixed(2)}km (>50km), ra=${computedApoapsis.toFixed(2)}km (<500000km)`;
            }
        }

        return {
            success: true,
            message: message,
            data: { 
                bodyId,
                randomValues: randomValues || undefined,
                orbitType,
                orbitParameters: {
                    a: orbitParams._a,
                    e: orbitParams.e,
                    periapsis: computedPeriapsis,
                    apoapsis: computedApoapsis,
                    period: orbitParams.period
                }
            }
        };
    }

    private handleRemoveBody(args: string[]): CommandResult {
        if (args.length === 0) {
            return {
                success: false,
                message: 'Missing body ID. Usage: REMOVE_BODY <bodyId>'
            };
        }

        const bodyId = args[0];
        const body = this.orbitalBodyIdMap.get(bodyId);

        if (!body) {
            return {
                success: false,
                message: `Body '${bodyId}' not found. Use LIST_BODIES to see available bodies.`
            };
        }

        this.gameLoop.removeOrbitalBody(body);
        this.orbitalBodyIdMap.delete(bodyId);

        return {
            success: true,
            message: `Removed body '${bodyId}'`
        };
    }

    private handleListBodies(): CommandResult {
        const bodies = Array.from(this.orbitalBodyIdMap.keys());
        // Include Earth (central body) in the list
        const centralBody = this.gameLoop.getCentralBody();
        const earthName = centralBody.getName();
        // Add Earth at the beginning if not already in the list
        if (!bodies.includes(earthName)) {
            bodies.unshift(earthName);
        }
        return {
            success: true,
            data: { bodies }
        };
    }

    private handleSetCameraFocus(args: string[]): CommandResult {
        if (args.length === 0) {
            return {
                success: false,
                message: 'Missing target name. Usage: SET_CAMERA_FOCUS <bodyName|Free Camera>'
            };
        }

        // Join all arguments to handle multi-word names like "Free Camera"
        const targetName = args.join(' ');
        const cameraManager = this.gameLoop.getCameraManager();

        // Check for Free Camera (case-insensitive)
        const targetLower = targetName.toLowerCase();
        if (targetLower === 'free camera' || targetLower === 'free') {
            cameraManager.switchToFreeCamera();
            return {
                success: true,
                message: 'Camera switched to Free Camera mode'
            };
        }

        // Try to switch to the body by name
        const success = cameraManager.switchToBodyByName(targetName);
        if (success) {
            return {
                success: true,
                message: `Camera switched to focus on '${targetName}'`
            };
        } else {
            return {
                success: false,
                message: `Body '${targetName}' not found. Use LIST_BODIES to see available bodies.`
            };
        }
    }

    private handleStart(): CommandResult {
        this.gameLoop.start();
        return {
            success: true,
            message: 'Simulation started'
        };
    }

    private handleStop(): CommandResult {
        this.gameLoop.stop();
        return {
            success: true,
            message: 'Simulation stopped'
        };
    }

    private handleHelp(): CommandResult {
        return {
            success: true,
            message: `Available commands:
RESET - Reset simulation to initial state (same as page refresh)
RESET [position:x,y,z] [velocity:x,y,z] [mass:value] [radius:value] [bodyId:id] - Reset a body with new parameters
RESET_ALL - Reset all simulation parameters and all orbital bodies to initial conditions
SET_TIME_SCALE <value> - Set simulation time scale
GET_ORBIT_INFO [bodyId] - Get orbit information for a body
GET_STATE [bodyId] - Get current state of a body
ADD_BODY [position:x,y,z] [velocity:x,y,z] [mass:value] [id:id] [radius:value] [color:hex] [trajectoryColor:hex] - Add a new orbital body (uses random values if no parameters provided)
REMOVE_BODY <bodyId> - Remove an orbital body
LIST_BODIES - List all orbital body IDs
SET_CAMERA_FOCUS <bodyName|Free Camera> - Switch camera focus to a body or free camera mode
START - Start the simulation
STOP - Stop the simulation
HELP - Show this help message`
        };
    }

    /**
     * Parse key-value pairs from command arguments
     * Example: ["position:15,5,3", "velocity:2,10,0"] -> {position: "15,5,3", velocity: "2,10,0"}
     */
    private parseKeyValuePairs(args: string[]): Record<string, string> {
        const result: Record<string, string> = {};
        for (const arg of args) {
            const match = arg.match(/^([^:]+):(.+)$/);
            if (match) {
                result[match[1].toLowerCase()] = match[2];
            }
        }
        return result;
    }

    /**
     * Parse a Vector3 from a string like "15,5,3"
     */
    private parseVector3(str: string): THREE.Vector3 | null {
        const parts = str.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 3 && parts.every(n => !isNaN(n))) {
            return new THREE.Vector3(parts[0], parts[1], parts[2]);
        }
        return null;
    }

    /**
     * Get a body by ID
     */
    getBody(bodyId: string): OrbitalBody | undefined {
        return this.orbitalBodyIdMap.get(bodyId);
    }

    /**
     * Get the default body (first body or 'default' body)
     */
    getDefaultBody(): OrbitalBody | null {
        const bodies = this.gameLoop.getOrbitalBodies();
        return bodies.length > 0 ? bodies[0] : null;
    }
}
