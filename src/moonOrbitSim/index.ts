import { MoonOrbitSimulation } from './app';

// Initialize and start the simulation when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const simulation = new MoonOrbitSimulation();
    simulation.start();
});
