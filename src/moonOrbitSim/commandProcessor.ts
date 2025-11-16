import * as THREE from 'three';
import { GameLoop } from './gameLoop';
import { OrbitalBody } from './orbitalBody';

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

    constructor(gameLoop: GameLoop) {
        this.gameLoop = gameLoop;
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
        const params = this.parseKeyValuePairs(args);
        
        const position = this.parseVector3(params.position || '15,5,3');
        const velocity = this.parseVector3(params.velocity || '2,10,0');
        const mass = parseFloat(params.mass || '1.0');
        const bodyId = params.bodyId || 'default';

        if (!position || !velocity || isNaN(mass)) {
            return {
                success: false,
                message: 'Invalid parameters. Expected: position:x,y,z velocity:x,y,z mass:value [bodyId:id]'
            };
        }

        // Get or create the body
        let body = this.orbitalBodyIdMap.get(bodyId);
        if (!body) {
            body = this.gameLoop.addOrbitalBody(
                position,
                velocity,
                mass,
                1.0,
                0xff6666,
                0xff6666,
                bodyId
            );
            this.orbitalBodyIdMap.set(bodyId, body);
        } else {
            this.gameLoop.resetOrbitalBody(body, position, velocity, mass);
        }

        const trajectory = body.getTrajectory();
        const params_data = trajectory.getParameters();

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
                    a: params_data.a,
                    e: params_data.e,
                    periapsis: params_data.a * (1 - params_data.e),
                    apoapsis: params_data.a * (1 + params_data.e)
                }
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
                    a: params.a,
                    e: params.e,
                    periapsis: params.a * (1 - params.e),
                    apoapsis: params.a * (1 + params.e),
                    period: params.period
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
                mass: body.getMass(),
                trailPoints: body.getTrailPoints().length
            }
        };
    }

    private handleAddBody(args: string[]): CommandResult {
        const params = this.parseKeyValuePairs(args);
        
        const position = this.parseVector3(params.position || '15,5,3');
        const velocity = this.parseVector3(params.velocity || '2,10,0');
        const mass = parseFloat(params.mass || '1.0');
        const bodyId = params.id || `body_${this.nextBodyId++}`;
        const radius = parseFloat(params.radius || '1.0');
        const color = params.color ? parseInt(params.color, 16) : 0xff6666;
        const trajectoryColor = params.trajectoryColor ? parseInt(params.trajectoryColor, 16) : 0xff6666;

        if (!position || !velocity || isNaN(mass)) {
            return {
                success: false,
                message: 'Invalid parameters. Expected: position:x,y,z velocity:x,y,z mass:value [id:id] [radius:value] [color:hex] [trajectoryColor:hex]'
            };
        }

        if (this.orbitalBodyIdMap.has(bodyId)) {
            return {
                success: false,
                message: `Body with id '${bodyId}' already exists. Use REMOVE_BODY first or use a different id.`
            };
        }

        const body = this.gameLoop.addOrbitalBody(
            position,
            velocity,
            mass,
            radius,
            color,
            trajectoryColor,
            bodyId
        );
        this.orbitalBodyIdMap.set(bodyId, body);

        return {
            success: true,
            message: `Added body '${bodyId}'`,
            data: { bodyId }
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
        return {
            success: true,
            data: { bodies }
        };
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
RESET [position:x,y,z] [velocity:x,y,z] [mass:value] [bodyId:id] - Reset simulation with new parameters
SET_TIME_SCALE <value> - Set simulation time scale
GET_ORBIT_INFO [bodyId] - Get orbit information for a body
GET_STATE [bodyId] - Get current state of a body
ADD_BODY [position:x,y,z] [velocity:x,y,z] [mass:value] [id:id] [radius:value] [color:hex] [trajectoryColor:hex] - Add a new orbital body
REMOVE_BODY <bodyId> - Remove an orbital body
LIST_BODIES - List all orbital body IDs
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

