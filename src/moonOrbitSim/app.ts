import { GameLoop } from './gameLoop';
import { SimulationController } from './simulationController';
import { UIManager } from './uiManager';
import { config, G, hexToNumber } from './config';

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
            
            // Initialize UI manager (sends commands to controller)
            // Pass camera manager for target display
            this.uiManager = new UIManager(this.simulationController, this.gameLoop.getCameraManager());

            // Initialize Moon with actual Earth-Moon system parameters from config
            const moonConfig = config.bodies.moon;
            const earthConfig = config.bodies.earth;
            const moonDistance = moonConfig.distance || 384400;
            
            // Calculate circular orbital velocity: v = sqrt(G * M_earth / r)
            // G is in km³/(kg·s²) for consistency with km-based distances
            // This gives velocity in km/s
            const moonVelocity = Math.sqrt(G * earthConfig.mass / moonDistance);
            
            // Place Moon at distance along x-axis, with velocity in z-direction for circular orbit in xz plane
            const addResult = this.simulationController.executeCommand(
                `ADD_BODY position:${moonDistance},0,0 velocity:0,0,${moonVelocity} mass:${moonConfig.mass} id:${moonConfig.name} radius:${moonConfig.radius} color:${moonConfig.color || 'cccccc'} trajectoryColor:${moonConfig.trajectoryColor || 'ffffff'}`
            );
            
            // Update UI to reflect Moon's orbit info
            if (addResult.success) {
                const orbitResult = this.simulationController.executeCommand(`GET_ORBIT_INFO ${moonConfig.name}`);
                if (orbitResult.success && orbitResult.data) {
                    this.uiManager.updateOrbitTypeDisplay({
                        type: orbitResult.data.orbitType,
                        parameters: orbitResult.data.parameters
                    });
                }
            }
        } catch (error) {
            console.error('Error initializing simulation:', error);
            throw error;
        }
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
