import { MoonOrbitSimulation } from './app';
import { createSinePlotDemo, createVelocityComparisonPlot } from './plotDemo';
import { checkVelocitySymmetry } from './velocitySymmetryTest';
import { config } from './config';
import { TransferCalculator } from './orbitUtils';


// Display error on the page if initialization fails
function displayError(error: any) {
    // Log to console in a structured format
    console.error('=== INITIALIZATION ERROR ===');
    console.error('Message:', error.message || String(error));
    console.error('Stack:', error.stack || 'No stack trace');
    console.error('Error object:', error);
    console.error('===========================');

    // Send error to server so it can be logged in terminal
    const errorData = {
        message: error.message || String(error),
        stack: error.stack || 'No stack trace',
        timestamp: new Date().toISOString()
    };

    fetch('/error-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorData)
    }).catch(() => {
        // Ignore if server endpoint doesn't exist
    });

    const errorDiv = document.createElement('div');
    errorDiv.id = 'error-display';
    errorDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 0, 0, 0.9);
        color: white;
        padding: 20px;
        border-radius: 5px;
        font-family: monospace;
        max-width: 80%;
        z-index: 10000;
        white-space: pre-wrap;
    `;
    errorDiv.textContent = `INITIALIZATION ERROR\n\n${error.message || error}\n\n${error.stack || ''}`;
    document.body.appendChild(errorDiv);

    // Also set document title to help identify error state
    document.title = 'ERROR: ' + (error.message || String(error));
}

// Initialize and start the simulation
function initializeSimulation() {
    try {
        console.log('[Index] Starting initialization...');
        const simulation = new MoonOrbitSimulation();
        simulation.start();

        // Expose controller globally for testing and automation
        // This allows commands to be executed programmatically without UI interaction
        (window as any).simulationController = simulation.getController();

        // Expose verification test
        (window as any).checkVelocitySymmetry = checkVelocitySymmetry;
        (window as any).runSymmetryTest = () => {
            const bodies = simulation.getController().getGameLoop().getOrbitalBodies();
            if (bodies.length > 0) {
                console.log(checkVelocitySymmetry(bodies[0]));
                return "Test Completed. Check console for details.";
            }
            return "No body found";
        };

        // Expose Lambert solver test
        (window as any).testLambertSolver = (numTests?: number) => {
            TransferCalculator.testLambertSolver(numTests);
            return "Lambert solver test completed. Check console for results.";
        };

        console.log('Simulation controller exposed globally. Use window.simulationController.executeCommand() for testing.');
        console.log('Lambert solver test available: window.testLambertSolver(numTests)');

        // Create orbit error plots (time warp and distance error)
        console.log('[Index] Creating orbit error plots...');
        const sinePlot = createSinePlotDemo();
        console.log('[Index] Orbit error plots created. Call window.createSinePlotDemo() to create additional plots.');

        // Auto-run Bezier orbit accuracy test (disabled - use TEST_BEZIER_ORBIT command manually)

        // Create velocity comparison plot for the Moon if enabled
        if (config.visualization.enableVelocityPlot) {
            const bodies = simulation.getController().getGameLoop().getOrbitalBodies();
            const moon = bodies.find(b => b.getName() === 'Moon');
            if (moon) {
                console.log('[Index] Creating velocity comparison plot for Moon...');
                createVelocityComparisonPlot(moon);
            } else if (bodies.length > 0) {
                console.log('[Index] Moon not found, creating velocity plot for first available body...');
                createVelocityComparisonPlot(bodies[0]);
            }
        }
    } catch (error) {
        console.error('[Index] Fatal error during initialization:', error);
        displayError(error);
        throw error;
    }
}

// Initialize when the DOM is ready
// Check if DOM is already loaded (in case script is loaded at end of body)
if (document.readyState === 'loading') {
    // DOM is still loading, wait for DOMContentLoaded
    document.addEventListener('DOMContentLoaded', initializeSimulation);
} else {
    // DOM is already loaded, initialize immediately
    initializeSimulation();
}
