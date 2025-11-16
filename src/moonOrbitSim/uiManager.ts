import { SimulationController } from './simulationController';
import { CameraManager } from './cameraManager';
import { config, G } from './config';

export class UIManager {
    private simulationController: SimulationController;
    private cameraManager?: CameraManager;
    private orbitTypeDiv!: HTMLDivElement;
    private cameraTargetDiv!: HTMLDivElement;
    private timeScaleSlider!: HTMLInputElement;
    private timeScaleValue!: HTMLSpanElement;
    private posXInput!: HTMLInputElement;
    private posYInput!: HTMLInputElement;
    private posZInput!: HTMLInputElement;
    private velXInput!: HTMLInputElement;
    private velYInput!: HTMLInputElement;
    private velZInput!: HTMLInputElement;
    private massInput!: HTMLInputElement;
    private commandInput!: HTMLInputElement;
    private commandOutput!: HTMLDivElement;

    constructor(simulationController: SimulationController, cameraManager?: CameraManager) {
        this.simulationController = simulationController;
        this.cameraManager = cameraManager;
        this.initializeUI();
        this.setupEventListeners();
        
        // Set initial time scale from config
        const defaultTimeScale = config.physics.defaultTimeScale;
        this.simulationController.executeCommand(`SET_TIME_SCALE ${defaultTimeScale}`);
        
        // Setup camera target change callback
        if (this.cameraManager) {
            this.cameraManager.setOnTargetChange((targetName) => {
                this.updateCameraTargetDisplay(targetName);
            });
            // Set initial display
            this.updateCameraTargetDisplay(this.cameraManager.getCurrentTargetName());
        }
        
        // Don't reset simulation here - let app.ts initialize the Moon first
        // The UI fields are already initialized with Moon parameters
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
            max-height: 90vh;
            overflow-y: auto;
        `;

        // Camera target display
        this.cameraTargetDiv = document.createElement('div');
        this.cameraTargetDiv.id = 'cameraTarget';
        this.cameraTargetDiv.style.cssText = `
            background: rgba(100,150,255,0.3);
            padding: 5px;
            margin-bottom: 10px;
            text-align: center;
            font-weight: bold;
        `;
        this.cameraTargetDiv.textContent = 'Camera Focus: Free Camera';
        controls.appendChild(this.cameraTargetDiv);

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

        // Initialize with Moon parameters from config
        const moonConfig = config.bodies.moon;
        const earthConfig = config.bodies.earth;
        const moonDistance = moonConfig.distance || 384400;
        const moonVelocity = Math.sqrt(G * earthConfig.mass / moonDistance);
        
        // Position inputs (Moon starts at distance along x-axis)
        const { container: posXContainer, input: posX } = createInput('posX', 'Position X:', moonDistance.toString(), '1000');
        const { container: posYContainer, input: posY } = createInput('posY', 'Position Y:', '0', '1000');
        const { container: posZContainer, input: posZ } = createInput('posZ', 'Position Z:', '0', '1000');
        
        // Velocity inputs (Moon velocity in z-direction for circular orbit in xz plane)
        const { container: velXContainer, input: velX } = createInput('velX', 'Velocity X:', '0', '0.001');
        const { container: velYContainer, input: velY } = createInput('velY', 'Velocity Y:', '0', '0.001');
        const { container: velZContainer, input: velZ } = createInput('velZ', 'Velocity Z:', moonVelocity.toFixed(6), '0.001');
        
        // Mass input (Moon mass)
        const { container: massContainer, input: mass } = createInput('mass', 'Mass:', moonConfig.mass.toString(), '1e20');

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
        // Will be set when slider is created below
        this.timeScaleValue.textContent = '1.0x';
        
        sliderLabel.appendChild(timeScaleSpan);
        sliderLabel.appendChild(this.timeScaleValue);
        
        this.timeScaleSlider = document.createElement('input');
        this.timeScaleSlider.type = 'range';
        this.timeScaleSlider.id = 'timeScale';
        this.timeScaleSlider.min = '1';
        this.timeScaleSlider.max = '10000';
        this.timeScaleSlider.step = '10';
        const defaultTimeScale = config.physics.defaultTimeScale;
        this.timeScaleSlider.value = defaultTimeScale.toString();
        this.timeScaleValue.textContent = defaultTimeScale.toFixed(1) + 'x';
        this.timeScaleSlider.style.width = '100%';
        
        sliderContainer.appendChild(sliderLabel);
        sliderContainer.appendChild(this.timeScaleSlider);
        controls.appendChild(sliderContainer);

        // Command interface (for testing/automation)
        const commandContainer = document.createElement('div');
        commandContainer.style.cssText = `
            margin-top: 10px;
            padding: 10px;
            border-top: 1px solid #666;
        `;
        commandContainer.innerHTML = '<h4 style="margin-top: 0;">Command Interface (for testing)</h4>';
        
        const commandInputContainer = document.createElement('div');
        commandInputContainer.style.cssText = 'display: flex; gap: 5px; margin-bottom: 5px;';
        
        this.commandInput = document.createElement('input');
        this.commandInput.type = 'text';
        this.commandInput.placeholder = 'Enter command (e.g., RESET position:20,5,3 velocity:2,8.5,0 mass:1.0)';
        this.commandInput.style.cssText = 'flex: 1; padding: 5px; background: rgba(255,255,255,0.1); color: white; border: 1px solid #666;';
        
        const commandButton = document.createElement('button');
        commandButton.textContent = 'Execute';
        commandButton.onclick = () => this.executeCommand();
        
        commandInputContainer.appendChild(this.commandInput);
        commandInputContainer.appendChild(commandButton);
        commandContainer.appendChild(commandInputContainer);
        
        this.commandOutput = document.createElement('div');
        this.commandOutput.id = 'commandOutput';
        this.commandOutput.style.cssText = `
            margin-top: 5px;
            padding: 5px;
            background: rgba(0,0,0,0.5);
            font-family: monospace;
            font-size: 11px;
            max-height: 100px;
            overflow-y: auto;
        `;
        commandContainer.appendChild(this.commandOutput);
        
        controls.appendChild(commandContainer);

        document.body.appendChild(controls);
    }

    private setupEventListeners(): void {
        this.timeScaleSlider.addEventListener('input', (e) => {
            const value = parseFloat((e.target as HTMLInputElement).value);
            this.timeScaleValue.textContent = value.toFixed(1) + 'x';
            // Send command instead of direct call
            this.simulationController.executeCommand(`SET_TIME_SCALE ${value}`);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.target === this.commandInput) {
                this.executeCommand();
            } else if (event.key === 'Enter') {
                this.resetSimulation();
            }
        });

        // Allow command input to execute on Enter
        this.commandInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.executeCommand();
            }
        });
    }

    resetSimulation(): void {
        try {
            const position = {
                x: parseFloat(this.posXInput.value),
                y: parseFloat(this.posYInput.value),
                z: parseFloat(this.posZInput.value)
            };
            
            const velocity = {
                x: parseFloat(this.velXInput.value),
                y: parseFloat(this.velYInput.value),
                z: parseFloat(this.velZInput.value)
            };
            
            const mass = parseFloat(this.massInput.value);

            // Use Moon as the body ID to update the actual Moon body
            const moonConfig = config.bodies.moon;
            const result = this.simulationController.executeCommand(
                `RESET position:${position.x},${position.y},${position.z} velocity:${velocity.x},${velocity.y},${velocity.z} mass:${mass} bodyId:${moonConfig.name}`
            );

            // Update UI based on command result
            if (result.success && result.data) {
                this.updateOrbitTypeDisplay({
                    type: result.data.orbitType,
                    parameters: result.data.orbitParameters
                });
            }
        } catch (error) {
            console.error('Error resetting simulation:', error);
        }
    }

    private executeCommand(): void {
        const command = this.commandInput.value.trim();
        if (!command) return;

        const result = this.simulationController.executeCommand(command);
        
        // Display result
        const output = this.commandOutput;
        const timestamp = new Date().toLocaleTimeString();
        const status = result.success ? '✓' : '✗';
        const message = result.message || (result.success ? 'Command executed' : 'Command failed');
        
        output.innerHTML += `<div style="color: ${result.success ? '#90EE90' : '#FF6B6B'};">
            [${timestamp}] ${status} ${command}<br>
            ${message}
        </div>`;
        
        // Auto-scroll to bottom
        output.scrollTop = output.scrollHeight;
        
        // Clear input
        this.commandInput.value = '';

        // If command was RESET or GET_ORBIT_INFO, update orbit display
        if (command.toUpperCase().startsWith('RESET') || command.toUpperCase().startsWith('GET_ORBIT_INFO')) {
            if (result.success && result.data && result.data.orbitType) {
                this.updateOrbitTypeDisplay({
                    type: result.data.orbitType,
                    parameters: result.data.parameters || result.data.orbitParameters
                });
            }
        }
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

    /**
     * Update camera target display
     */
    updateCameraTargetDisplay(targetName: string | null): void {
        if (this.cameraTargetDiv) {
            if (targetName === null) {
                this.cameraTargetDiv.textContent = 'Camera Focus: Free Camera';
            } else {
                this.cameraTargetDiv.textContent = `Camera Focus: ${targetName}`;
            }
        }
    }
}
