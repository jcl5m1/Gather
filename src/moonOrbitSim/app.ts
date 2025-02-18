import { SceneManager } from './sceneManager';
import { SimulationManager } from './simulationManager';
import { UIManager } from './uiManager';
import { generateEllipsePoints, generateBezierOrbitPoints } from './orbitUtils';
import * as THREE from 'three';

export class MoonOrbitSimulation {
    private sceneManager: SceneManager;
    private simulationManager: SimulationManager;
    private uiManager: UIManager;
    private animationFrameId: number = 0;

    constructor() {
        this.simulationManager = new SimulationManager();
        this.sceneManager = new SceneManager();
        this.uiManager = new UIManager(this.simulationManager, () => this.updateOrbitVisualizations());

        // Initialize simulation with values from UI
        this.uiManager.resetSimulation();

        this.animate = this.animate.bind(this);
    }

    start(): void {
        this.animate();
    }

    stop(): void {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }

    private updateOrbitVisualizations(): void {
        const orbitGeometry = this.simulationManager.calculateOrbitType();
        const { orbitAnalytical, orbitBezier } = this.simulationManager.getOrbitPoints();

        if (orbitGeometry.type === 'elliptical') {
            this.sceneManager.showOrbitVisualizations(true);
            this.sceneManager.updateAnalyticalOrbit(orbitAnalytical);
            this.sceneManager.updateBezierOrbit(orbitBezier);

            if (orbitGeometry.periapsisPoint && orbitGeometry.apoapsisPoint) {
                this.sceneManager.updateMarkers(
                    orbitGeometry.periapsisPoint,
                    orbitGeometry.apoapsisPoint,
                    true
                );
            }
        } else {
            this.sceneManager.showOrbitVisualizations(false);
            this.sceneManager.updateAnalyticalOrbit([]);
            this.sceneManager.updateBezierOrbit([]);
        }
    }

    private animate(): void {
        this.animationFrameId = requestAnimationFrame(this.animate);

        // Update simulation state
        this.simulationManager.update();

        // Get updated states
        const { moonIterative, moonAnalytical } = this.simulationManager.getMoonStates();
        const { orbitIterative } = this.simulationManager.getOrbitPoints();

        // Update scene geometry
        this.sceneManager.updateMoonPositions(moonIterative, moonAnalytical);
        this.sceneManager.updateIterativeOrbitTrails(orbitIterative);

        // Update orbit visualizations including markers
        const orbitGeometry = this.simulationManager.calculateOrbitType();
        if (orbitGeometry.type === 'elliptical' && orbitGeometry.periapsisPoint && orbitGeometry.apoapsisPoint) {
            this.sceneManager.updateMarkers(
                orbitGeometry.periapsisPoint,
                orbitGeometry.apoapsisPoint,
                true
            );
        }

        // Update UI with simplified orbit info
        this.uiManager.updateOrbitTypeDisplay(this.simulationManager.getUIOrbitInfo());

        // Render scene
        this.sceneManager.render();
    }
}
