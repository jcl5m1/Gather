import { SimulationManager } from './simulationManager';
import * as THREE from 'three';

export class UIManager {
    private simulationManager: SimulationManager;
    private orbitTypeDiv!: HTMLDivElement;
    private timeScaleSlider!: HTMLInputElement;
    private timeScaleValue!: HTMLSpanElement;
    private posXInput!: HTMLInputElement;
    private posYInput!: HTMLInputElement;
    private posZInput!: HTMLInputElement;
    private velXInput!: HTMLInputElement;
    private velYInput!: HTMLInputElement;
    private velZInput!: HTMLInputElement;
    private massInput!: HTMLInputElement;
    private onResetCallback: () => void;

    constructor(simulationManager: SimulationManager, onReset: () => void) {
        this.simulationManager = simulationManager;
        this.onResetCallback = onReset;
        this.initializeUI();
        this.setupEventListeners();
    }

    private initializeUI(): void {
        // Create main controls container
        const controls = document.createElement('div');
        controls.id = 'controls';
        controls.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 10px;
            font-family: Arial, sans-serif;
        `;

        // Orbit type display
        this.orbitTypeDiv = document.createElement('div');
        this.orbitTypeDiv.id = 'orbitType';
        this.orbitTypeDiv.style.cssText = `
            background: rgba(255,255,255,0.2);
            padding: 5px;
            margin-bottom: 10px;
            text-align: center;
        `;
        this.orbitTypeDiv.textContent = 'Orbit Type: Unknown';
        controls.appendChild(this.orbitTypeDiv);

        // Moon parameters section
        const moonParams = document.createElement('div');
        moonParams.className = 'control-group';
        moonParams.innerHTML = '<h3>Moon Parameters</h3>';

        // Create input fields
        const createInput = (id: string, label: string, value: string, step: string) => {
            const container = document.createElement('div');
            const labelElement = document.createElement('label');
            labelElement.style.cssText = 'display: inline-block; width: 120px;';
            labelElement.textContent = label;
            
            const input = document.createElement('input');
            input.type = 'number';
            input.id = id;
            input.value = value;
            input.step = step;
            
            container.appendChild(labelElement);
            container.appendChild(input);
            return { container, input };
        };

        // Position inputs
        const { container: posXContainer, input: posX } = createInput('posX', 'Position X:', '15', '1');
        const { container: posYContainer, input: posY } = createInput('posY', 'Position Y:', '5', '1');
        const { container: posZContainer, input: posZ } = createInput('posZ', 'Position Z:', '3', '1');
        
        // Velocity inputs
        const { container: velXContainer, input: velX } = createInput('velX', 'Velocity X:', '2', '0.1');
        const { container: velYContainer, input: velY } = createInput('velY', 'Velocity Y:', '10.0', '0.1');
        const { container: velZContainer, input: velZ } = createInput('velZ', 'Velocity Z:', '0', '0.1');
        
        // Mass input
        const { container: massContainer, input: mass } = createInput('mass', 'Mass:', '1.0', '0.1');

        // Store input references
        this.posXInput = posX;
        this.posYInput = posY;
        this.posZInput = posZ;
        this.velXInput = velX;
        this.velYInput = velY;
        this.velZInput = velZ;
        this.massInput = mass;

        // Add inputs to moon parameters section
        [posXContainer, posYContainer, posZContainer,
         velXContainer, velYContainer, velZContainer,
         massContainer].forEach(container => moonParams.appendChild(container));

        controls.appendChild(moonParams);

        // Reset button
        const resetButton = document.createElement('button');
        resetButton.textContent = 'Reset Simulation';
        resetButton.onclick = () => this.resetSimulation();
        controls.appendChild(resetButton);

        // Time scale slider
        const sliderContainer = document.createElement('div');
        sliderContainer.className = 'slider-container';
        sliderContainer.style.cssText = `
            margin-top: 10px;
            padding: 10px;
            border-top: 1px solid #666;
        `;

        const sliderLabel = document.createElement('div');
        sliderLabel.className = 'slider-label';
        sliderLabel.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 5px;';
        
        const timeScaleSpan = document.createElement('span');
        timeScaleSpan.textContent = 'Time Scale: ';
        
        this.timeScaleValue = document.createElement('span');
        this.timeScaleValue.id = 'timeScaleValue';
        this.timeScaleValue.textContent = '1.0x';
        
        sliderLabel.appendChild(timeScaleSpan);
        sliderLabel.appendChild(this.timeScaleValue);
        
        this.timeScaleSlider = document.createElement('input');
        this.timeScaleSlider.type = 'range';
        this.timeScaleSlider.id = 'timeScale';
        this.timeScaleSlider.min = '1';
        this.timeScaleSlider.max = '1000';
        this.timeScaleSlider.step = '0.1';
        this.timeScaleSlider.value = '1';
        this.timeScaleSlider.style.width = '100%';
        
        sliderContainer.appendChild(sliderLabel);
        sliderContainer.appendChild(this.timeScaleSlider);
        controls.appendChild(sliderContainer);

        document.body.appendChild(controls);
    }

    private setupEventListeners(): void {
        this.timeScaleSlider.addEventListener('input', (e) => {
            const value = parseFloat((e.target as HTMLInputElement).value);
            this.timeScaleValue.textContent = value.toFixed(1) + 'x';
            this.simulationManager.setTimeScale(value);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.resetSimulation();
            }
        });
    }

    resetSimulation(): void {
        const position = new THREE.Vector3(
            parseFloat(this.posXInput.value),
            parseFloat(this.posYInput.value),
            parseFloat(this.posZInput.value)
        );
        
        const velocity = new THREE.Vector3(
            parseFloat(this.velXInput.value),
            parseFloat(this.velYInput.value),
            parseFloat(this.velZInput.value)
        );
        
        const mass = parseFloat(this.massInput.value);

        this.simulationManager.resetSimulation(position, velocity, mass);
        this.onResetCallback();
    }

    updateOrbitTypeDisplay(orbitInfo: {
        type: string;
        parameters?: {
            a: number;
            e: number;
            periapsis: number;
            apoapsis: number;
        };
    }): void {
        if (orbitInfo.type === 'elliptical' && orbitInfo.parameters) {
            this.orbitTypeDiv.innerHTML = `Orbit Type: Elliptical<br>
                Semi-major axis: ${orbitInfo.parameters.a.toFixed(2)}<br>
                Eccentricity: ${orbitInfo.parameters.e.toFixed(3)}<br>
                Periapsis: ${orbitInfo.parameters.periapsis.toFixed(2)}<br>
                Apoapsis: ${orbitInfo.parameters.apoapsis.toFixed(2)}`;
            this.orbitTypeDiv.style.color = '#90EE90'; // Light green
        } else if (orbitInfo.type === 'hyperbolic') {
            this.orbitTypeDiv.textContent = 'Orbit Type: Hyperbolic';
            this.orbitTypeDiv.style.color = '#FFB6C1'; // Light red
        } else {
            this.orbitTypeDiv.textContent = 'Orbit Type: Parabolic';
            this.orbitTypeDiv.style.color = '#ADD8E6'; // Light blue
        }
    }
}
