import { MoonOrbitSimulation } from './app';

// Initialize and start the simulation when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const simulation = new MoonOrbitSimulation();
    simulation.start();
    
    // Expose controller globally for testing and automation
    // This allows commands to be executed programmatically without UI interaction
    (window as any).simulationController = simulation.getController();
    console.log('Simulation controller exposed globally. Use window.simulationController.executeCommand() for testing.');
});
