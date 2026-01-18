import { GameLoop } from './gameLoop';
import { CommandProcessor } from './commandProcessor';
import { OrbitalBody } from './orbitalBody';

import { TransferCalculator } from './transferCalculator';
import { MeasureVector3, LengthVector3, VelocityVector3 } from './unitsVector3';
import { Measure, kilometers, seconds, kilograms, Length, Velocity } from './units';
import { TransferTrajectory } from './transferTrajectory';

/**
 * SimulationController provides a command-based interface to the simulation
 * This allows the simulation to be controlled and tested without UI rendering
 */
export class SimulationController {
    private gameLoop: GameLoop;
    private commandProcessor: CommandProcessor;
    private commandHistory: string[] = [];
    private maxHistorySize: number = 100;
    private initializeSimulationCallback?: () => void;

    constructor(gameLoop: GameLoop) {
        this.gameLoop = gameLoop;
        this.commandProcessor = new CommandProcessor(gameLoop);
    }

    /**
     * Set the callback for initializing the simulation (called by RESET command)
     */
    setInitializeSimulationCallback(callback: () => void): void {
        this.initializeSimulationCallback = callback;
        this.commandProcessor.setInitializeSimulationCallback(() => {
             callback();
             
             // Auto-Initialization Logic:
             // 1. Wait a brief moment for bodies to be created and registered
             setTimeout(() => {
                 this.autoInitialize();
             }, 100);
        });
    }

    private autoInitialize(): void {
         // Get Rocket and Moon
         const rocket = this.commandProcessor.getBody('Rocket');
         const moon = this.commandProcessor.getBody('Moon');
         
         if (rocket && moon) {
             console.log('[AutoInit] Found Rocket and Moon. executing setup...');
             
             // 2. Set Camera Focus to Rocket
             this.executeCommand('SET_CAMERA_FOCUS Rocket');
             
             // 3. Set Rocket's target to Moon
             rocket.target = moon;
             
             // 4. Compute Transfer
             try {
                 const centralBody = this.gameLoop.getCentralBody();
                 const result = TransferCalculator.calculateHohmannTransfer(
                     rocket,
                     moon,
                     centralBody.getMass()
                 );
                 
                 if (result) {
                     const scene = this.gameLoop.getScene();
                     const transferTrajectory = new TransferTrajectory(scene, 0xffff00);
                     
                     const currentTime = this.gameLoop.getCurrentTime();
                     transferTrajectory.setTimes(currentTime, currentTime + result.timeOfFlight);
                     transferTrajectory.setDeltaVs(result.deltaV1, result.deltaV2);
                     
                     const posMeasure = MeasureVector3.fromVector3<Length>(result.position, kilometers);
                     const velMeasure = MeasureVector3.fromVector3<Velocity>(result.velocity, kilometers.per(seconds));
                     const centralMassMeasure = Measure.of(centralBody.getMass(), kilograms);
                     const startTimeMeasure = Measure.of(currentTime, seconds);
                     
                     transferTrajectory.calculateFromState(posMeasure, velMeasure, centralMassMeasure, startTimeMeasure);
                     
                     rocket.setTransferTrajectory(transferTrajectory, result.startPosition, result.endPosition);
                     console.log('[AutoInit] Transfer Computed and set on Rocket');
                     
                     // Force UI update
                     // Since we are outside the normal command flow, we can trigger a refresh if needed
                     // But typically SET_CAMERA_FOCUS above already triggered a refresh.
                     // Because this runs after a timeout, we might need another refresh.
                     // Checking if we can access UIManager... we can't directly.
                     // But we can execute a dummy command or similar.
                     // The Property Inspector updates periodically or on commands.
                     // Let's rely on SET_CAMERA_FOCUS having run recently, or user interaction.
                     // Actually, we want the "Transfer Trajectory" section to appear.
                     // This only happens on updateAllSections.
                     // SET_CAMERA_FOCUS triggers updateAllSections.
                     // But we calculate transfer AFTER that.
                     // So we might need to trigger another update.
                 }
             } catch (e) {
                 console.error('[AutoInit] Error calculating transfer', e);
             }
         }
    }

    /**
     * Execute a command and return the result
     * @param command - Text command string
     * @returns CommandResult with success status and optional message/data
     */
    executeCommand(command: string): import('./commandProcessor').CommandResult {
        // Add to history
        this.commandHistory.push(command);
        if (this.commandHistory.length > this.maxHistorySize) {
            this.commandHistory.shift();
        }

        // Process command
        const result = this.commandProcessor.processCommand(command);
        
        // Log command execution
        if (result.success) {
            console.log(`[COMMAND] ${command} -> SUCCESS${result.message ? ': ' + result.message : ''}`);
        } else {
            console.error(`[COMMAND] ${command} -> FAILED: ${result.message || 'Unknown error'}`);
        }

        return result;
    }

    /**
     * Get command history
     */
    getCommandHistory(): string[] {
        return [...this.commandHistory];
    }

    /**
     * Get the command processor (for advanced usage)
     */
    getCommandProcessor(): CommandProcessor {
        return this.commandProcessor;
    }

    /**
     * Clear all bodies from the command processor's tracking
     */
    clearAllBodies(): void {
        this.commandProcessor.clearAllBodies();
    }

    /**
     * Get the game loop (for advanced usage)
     */
    getGameLoop(): GameLoop {
        return this.gameLoop;
    }

    /**
     * Convenience method to reset simulation
     */
    reset(position: { x: number; y: number; z: number }, velocity: { x: number; y: number; z: number }, mass: number, bodyId: string = 'default'): import('./commandProcessor').CommandResult {
        const cmd = `RESET position:${position.x},${position.y},${position.z} velocity:${velocity.x},${velocity.y},${velocity.z} mass:${mass} bodyId:${bodyId}`;
        return this.executeCommand(cmd);
    }

    /**
     * Convenience method to set time scale
     */
    setTimeScale(scale: number): import('./commandProcessor').CommandResult {
        return this.executeCommand(`SET_TIME_SCALE ${scale}`);
    }

    /**
     * Convenience method to get orbit info
     */
    getOrbitInfo(bodyId: string = 'default'): import('./commandProcessor').CommandResult {
        return this.executeCommand(`GET_ORBIT_INFO ${bodyId}`);
    }

    /**
     * Convenience method to get state
     */
    getState(bodyId: string = 'default'): import('./commandProcessor').CommandResult {
        return this.executeCommand(`GET_STATE ${bodyId}`);
    }

    /**
     * Get trajectory object for a body (for inspector introspection)
     */
    getTrajectory(bodyId: string = 'default'): import('./trajectory').Trajectory | null {
        const commandProcessor = this.getCommandProcessor();
        const body = commandProcessor.getBody(bodyId);
        if (!body) {
            return null;
        }
        return body.getTrajectory();
    }

    /**
     * Get orbital body object for a body (for inspector introspection)
     */
    getBody(bodyId: string = 'default'): OrbitalBody | null {
        const commandProcessor = this.getCommandProcessor();
        const body = commandProcessor.getBody(bodyId);
        return body || null;
    }
}

