import { GameLoop } from './gameLoop';
import { SimulationController } from './simulationController';
import { UIManager } from './uiManager';
import { config, G, hexToNumber } from './config';
import { gravitationalConstantUnit } from './units';
import { kilometers, kilograms } from './units';

export class MoonOrbitSimulation {
    private gameLoop: GameLoop;
    private simulationController: SimulationController;
    private uiManager: UIManager;

    constructor() {
        try {
            // Initialize game loop
            this.gameLoop = new GameLoop();

            // Initialize simulation controller (command-based interface)
            this.simulationController = new SimulationController(this.gameLoop);

            // Set the initialization callback so RESET command can call it
            this.simulationController.setInitializeSimulationCallback(() => {
                this.initializeSimulation();
            });

            // Initialize UI manager (sends commands to controller)
            // Pass camera manager for target display
            this.uiManager = new UIManager(this.simulationController, this.gameLoop.getCameraManager());

            // Initialize simulation to initial state
            this.initializeSimulation();
        } catch (error) {
            console.error('Error initializing simulation:', error);
            throw error;
        }
    }

    /**
     * Initialize simulation to initial state (fresh start)
     * This method is called on page load and can be called via RESET command
     * It completely clears all bodies and starts with a fresh array
     */
    initializeSimulation(): void {
        console.log('[initializeSimulation] Starting full reset...');

        // Stop the simulation if running
        this.gameLoop.stop();
        console.log('[initializeSimulation] Simulation stopped');

        // Clear all bodies from command processor's tracking map first
        // This ensures no stale references remain
        this.simulationController.clearAllBodies();
        console.log('[initializeSimulation] Command processor body map cleared');

        // Remove all orbital bodies from the game loop
        // This frees all resources (trails, meshes, etc.) and clears the array
        const bodyCountBefore = this.gameLoop.getOrbitalBodies().length;
        this.gameLoop.removeAllOrbitalBodies();
        console.log(`[initializeSimulation] Removed ${bodyCountBefore} orbital bodies`);

        // Verify the array is empty (should be after removeAllOrbitalBodies)
        const bodies = this.gameLoop.getOrbitalBodies();
        if (bodies.length !== 0) {
            console.error(`[initializeSimulation] Error: orbitalBodies array has ${bodies.length} bodies after removeAllOrbitalBodies()`);
            // Force clear it as a safety measure
            bodies.length = 0;
        } else {
            console.log('[initializeSimulation] Verified: orbitalBodies array is empty');
        }

        // Reset time scale to default
        this.gameLoop.setTimeScale(config.physics.defaultTimeScale);

        // Reset current time to 0
        this.gameLoop.resetCurrentTime();

        // Reset camera to initial position
        const cameraManager = this.gameLoop.getCameraManager();
        cameraManager.resetToInitial();

        // Initialize all bodies from config
        console.log('[initializeSimulation] Loading bodies from config...');
        Object.keys(config.bodies).forEach(key => {
            const body = config.bodies[key];
            
            // Skip Earth as it is the central body
            if (body.name === 'Earth' || key === 'earth') {
                return;
            }

            console.log(`[initializeSimulation] Adding body: ${body.name}`);
            this.simulationController.executeCommand(
                `ADD_BODY position:${body.position.x},${body.position.y},${body.position.z} velocity:${body.velocity.x},${body.velocity.y},${body.velocity.z} mass:${body.mass} id:${body.name} radius:${body.radius} color:${body.color || 'cccccc'} trajectoryColor:${body.trajectoryColor || 'ffffff'} parentId:${body.parentId || ''} texture:${body.texture || ''}`
            );
        });

        // Update all UI sections
        this.uiManager.updateAllSections();

        // Restart the simulation after initialization
        // This ensures the simulation continues running after a reset
        this.gameLoop.start();
        console.log('[initializeSimulation] Simulation restarted');
        console.log(`[initializeSimulation] Reset complete. Bodies: ${this.gameLoop.getOrbitalBodies().length}, Time scale: ${this.gameLoop.getTimeScale()}`);
    }

    start(): void {
        this.gameLoop.start();
    }

    stop(): void {
        this.gameLoop.stop();
    }

    /**
     * Get the simulation controller for command-based control
     */
    getController(): SimulationController {
        return this.simulationController;
    }

    /**
     * Get the game loop (for advanced usage)
     */
    getGameLoop(): GameLoop {
        return this.gameLoop;
    }
}
