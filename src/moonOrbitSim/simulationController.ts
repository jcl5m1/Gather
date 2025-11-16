import { GameLoop } from './gameLoop';
import { CommandProcessor } from './commandProcessor';
import { OrbitalBody } from './orbitalBody';

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
        this.commandProcessor.setInitializeSimulationCallback(callback);
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
}

