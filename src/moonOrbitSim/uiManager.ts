import { SimulationController } from './simulationController';
import { CameraManager } from './cameraManager';
import { config, G } from './config';

// Use require for marked to avoid TypeScript module resolution issues
const markedModule = require('marked');
const markedFunction = markedModule.marked || markedModule.default || markedModule;

// Configure marked to render single newlines as line breaks (no extra spacing)
if (markedFunction.setOptions) {
    markedFunction.setOptions({
        breaks: true  // Render single newlines as <br> instead of requiring double newlines
    });
}
const marked = markedFunction;

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
    private bodyParamsHeading!: HTMLHeadingElement;
    private currentFocusedBodyName: string | null = null;
    private updateInterval: number | null = null;
    private currentOrbitInfo: { type: string; parameters?: any } | null = null;

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
                this.updateFormForFocusedBody(targetName);
                this.startCurrentValuesUpdates(targetName);
            });
            // Set initial display
            const initialTarget = this.cameraManager.getCurrentTargetName();
            this.updateCameraTargetDisplay(initialTarget);
            this.updateFormForFocusedBody(initialTarget);
            this.startCurrentValuesUpdates(initialTarget);
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

        // Body parameters section
        const bodyParams = document.createElement('div');
        bodyParams.className = 'control-group';
        this.bodyParamsHeading = document.createElement('h3');
        this.bodyParamsHeading.textContent = 'Body Parameters';
        bodyParams.appendChild(this.bodyParamsHeading);

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

        // Add inputs to body parameters section
        [posXContainer, posYContainer, posZContainer,
         velXContainer, velYContainer, velZContainer,
         massContainer].forEach(container => bodyParams.appendChild(container));

        controls.appendChild(bodyParams);

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

        document.body.appendChild(controls);

        // Command interface (for testing/automation) - separate UI element at bottom
        this.initializeCommandInterface();
    }

    private initializeCommandInterface(): void {
        // Create command interface container at bottom of page
        const commandContainer = document.createElement('div');
        commandContainer.id = 'commandInterface';
        commandContainer.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            width: 100%;
            background: rgba(0,0,0,0.85);
            color: white;
            padding: 10px;
            font-family: Arial, sans-serif;
            border-top: 2px solid #666;
            z-index: 1000;
        `;
        
        
        const commandInputContainer = document.createElement('div');
        commandInputContainer.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';
        
        this.commandInput = document.createElement('input');
        this.commandInput.type = 'text';
        this.commandInput.placeholder = 'Enter command (e.g., RESET position:20,5,3 velocity:2,8.5,0 mass:1.0)';
        this.commandInput.style.cssText = `
            flex: 1;
            padding: 8px;
            background: rgba(255,255,255,0.1);
            color: white;
            border: 1px solid #666;
            font-family: monospace;
            font-size: 12px;
        `;
        
        const commandButton = document.createElement('button');
        commandButton.textContent = 'Execute';
        commandButton.style.cssText = `
            padding: 8px 16px;
            background: rgba(100,150,255,0.8);
            color: white;
            border: 1px solid #666;
            cursor: pointer;
            font-size: 12px;
        `;
        commandButton.onclick = () => this.executeCommand();
        
        commandInputContainer.appendChild(this.commandInput);
        commandInputContainer.appendChild(commandButton);
        commandContainer.appendChild(commandInputContainer);
        
        this.commandOutput = document.createElement('div');
        this.commandOutput.id = 'commandOutput';
        this.commandOutput.style.cssText = `
            padding: 8px;
            background: rgba(0,0,0,0.6);
            font-family: monospace;
            font-size: 11px;
            max-height: 150px;
            overflow-y: auto;
            border: 1px solid #444;
        `;
        // Add CSS to eliminate spacing between lines in markdown output
        const style = document.createElement('style');
        style.textContent = `
            #commandOutput p {
                margin: 0;
                padding: 0;
            }
            #commandOutput br {
                line-height: 1;
            }
        `;
        document.head.appendChild(style);
        commandContainer.appendChild(this.commandOutput);
        
        document.body.appendChild(commandContainer);
    }

    private setupEventListeners(): void {
        this.timeScaleSlider.addEventListener('input', (e) => {
            const value = parseFloat((e.target as HTMLInputElement).value);
            this.timeScaleValue.textContent = value.toFixed(1) + 'x';
            // Execute command through command interface
            this.executeAndDisplayCommand(`SET_TIME_SCALE ${value}`);
        });

        // Add change listeners to parameter inputs to update the focused body
        const parameterInputs = [
            this.posXInput, this.posYInput, this.posZInput,
            this.velXInput, this.velYInput, this.velZInput,
            this.massInput
        ];
        
        // Debounce timer for input events (shared across all inputs)
        let inputDebounceTimer: number | null = null;
        
        parameterInputs.forEach(input => {
            input.addEventListener('change', () => {
                this.resetSimulation();
            });
            // Also update on input for real-time feedback (but debounce to avoid too many updates)
            input.addEventListener('input', () => {
                if (inputDebounceTimer !== null) {
                    clearTimeout(inputDebounceTimer);
                }
                inputDebounceTimer = window.setTimeout(() => {
                    this.resetSimulation();
                    inputDebounceTimer = null;
                }, 500); // Debounce: update 500ms after user stops typing
            });
        });

        document.addEventListener('keydown', (event) => {
            // Only handle if not typing in an input field (except command input)
            if (event.target instanceof HTMLInputElement && event.target !== this.commandInput) {
                return;
            }
            if (event.target instanceof HTMLTextAreaElement) {
                return;
            }

            if (event.key === 'Enter' && event.target === this.commandInput) {
                this.executeCommand();
            } else if (event.key === 'Enter') {
                this.resetSimulation();
            } else if (event.key === ' ') {
                event.preventDefault();
                // Space key triggers ADD_BODY (with random values)
                this.executeAndDisplayCommand('ADD_BODY');
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
            // Execute RESET command with no parameters to reset to initial state
            // This matches the behavior of typing "RESET" in the command line
            const resetResult = this.executeAndDisplayCommand('RESET');

            // Update UI based on command result
            if (resetResult.success && resetResult.data) {
                // Update time scale display
                const timeScale = resetResult.data.timeScale;
                if (timeScale !== undefined) {
                    this.timeScaleSlider.value = timeScale.toString();
                    this.timeScaleValue.textContent = timeScale.toFixed(1) + 'x';
                }
                
                // Update orbit display if Moon was re-added
                if (resetResult.data.bodies && resetResult.data.bodies.length > 0) {
                    const moonName = resetResult.data.bodies[0];
                    const orbitResult = this.executeAndDisplayCommand(`GET_ORBIT_INFO ${moonName}`);
                    if (orbitResult.success && orbitResult.data) {
                        this.updateOrbitTypeDisplay({
                            type: orbitResult.data.orbitType,
                            parameters: orbitResult.data.parameters
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Error resetting simulation:', error);
        }
    }

    /**
     * Execute a command and display it in the command output
     * This is used by UI interactions to ensure all actions are logged
     */
    private executeAndDisplayCommand(command: string): any {
        const result = this.simulationController.executeCommand(command);
        
        // Display result
        const output = this.commandOutput;
        const timestamp = new Date().toLocaleTimeString();
        const status = result.success ? '✓' : '✗';
        const message = result.message || (result.success ? 'Command executed' : 'Command failed');
        
        // Render message as markdown
        const renderedMessage = marked(message) as string;
        
        output.innerHTML += `<div style="color: ${result.success ? '#90EE90' : '#FF6B6B'};">
            [${timestamp}] ${status} ${command}<br>
            ${renderedMessage}
        </div>`;
        
        // Auto-scroll to bottom
        output.scrollTop = output.scrollHeight;

        // If command was RESET or GET_ORBIT_INFO, update orbit display
        if (command.toUpperCase().startsWith('RESET') || command.toUpperCase().startsWith('GET_ORBIT_INFO')) {
            if (result.success && result.data && result.data.orbitType) {
                this.updateOrbitTypeDisplay({
                    type: result.data.orbitType,
                    parameters: result.data.parameters || result.data.orbitParameters
                });
            }
        }

        return result;
    }

    /**
     * Execute command from the command input field
     */
    private executeCommand(): void {
        const command = this.commandInput.value.trim();
        if (!command) return;

        this.executeAndDisplayCommand(command);
        
        // Clear input
        this.commandInput.value = '';
    }

    updateOrbitTypeDisplay(orbitInfo: {
        type: string;
        parameters?: {
            a: number;
            e: number;
            periapsis: number;
            apoapsis: number;
        };
    }, currentAltitude?: number, currentVelocity?: number): void {
        // Store orbit info for real-time updates
        this.currentOrbitInfo = orbitInfo;
        
        let tableHTML = '<table style="width: 100%; border-collapse: collapse; text-align: left;">';
        
        if (orbitInfo.type === 'elliptical' && orbitInfo.parameters) {
            tableHTML += `
                <tr><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;"><strong>Orbit Type:</strong></td><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">Elliptical</td></tr>
                <tr><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">Semi-major axis:</td><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">${this.formatDistance(orbitInfo.parameters.a)}</td></tr>
                <tr><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">Eccentricity:</td><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">${orbitInfo.parameters.e.toFixed(3)}</td></tr>
                <tr><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">Periapsis:</td><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">${this.formatDistance(orbitInfo.parameters.periapsis)}</td></tr>
                <tr><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">Apoapsis:</td><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">${this.formatDistance(orbitInfo.parameters.apoapsis)}</td></tr>`;
            this.orbitTypeDiv.style.color = '#90EE90'; // Light green
        } else if (orbitInfo.type === 'hyperbolic') {
            tableHTML += `<tr><td style="padding: 2px 5px; text-align: left;"><strong>Orbit Type:</strong></td><td style="padding: 2px 5px; text-align: left;">Hyperbolic</td></tr>`;
            this.orbitTypeDiv.style.color = '#FFB6C1'; // Light red
        } else {
            tableHTML += `<tr><td style="padding: 2px 5px; text-align: left;"><strong>Orbit Type:</strong></td><td style="padding: 2px 5px; text-align: left;">Parabolic</td></tr>`;
            this.orbitTypeDiv.style.color = '#ADD8E6'; // Light blue
        }
        
        // Add current altitude and velocity
        if (currentAltitude !== undefined && currentVelocity !== undefined) {
            tableHTML += `
                <tr><td style="padding: 2px 5px; border-top: 1px solid rgba(255,255,255,0.3); border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">Altitude:</td><td style="padding: 2px 5px; border-top: 1px solid rgba(255,255,255,0.3); border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">${this.formatDistance(currentAltitude)}</td></tr>
                <tr><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">Velocity:</td><td style="padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;">${this.formatVelocity(currentVelocity)}</td></tr>`;
        }
        
        tableHTML += '</table>';
        this.orbitTypeDiv.innerHTML = tableHTML;
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

    /**
     * Update form fields to show the currently focused body's parameters
     */
    private updateFormForFocusedBody(targetName: string | null): void {
        this.currentFocusedBodyName = targetName;
        
        // Check if this is the central body (Earth) - central body doesn't orbit, so we can't edit it
        const isCentralBody = targetName === config.bodies.earth.name;
        
        // Update heading
        if (this.bodyParamsHeading) {
            if (targetName === null) {
                this.bodyParamsHeading.textContent = 'Body Parameters (No Focus)';
            } else if (isCentralBody) {
                this.bodyParamsHeading.textContent = `${targetName} Parameters (Central Body - Read Only)`;
            } else {
                this.bodyParamsHeading.textContent = `${targetName} Parameters`;
            }
        }

        // If no body is focused or it's the central body, disable inputs
        if (targetName === null || isCentralBody) {
            // Disable inputs when no body is focused or it's the central body
            this.posXInput.disabled = true;
            this.posYInput.disabled = true;
            this.posZInput.disabled = true;
            this.velXInput.disabled = true;
            this.velYInput.disabled = true;
            this.velZInput.disabled = true;
            this.massInput.disabled = true;
            
            // If it's the central body, show its parameters but don't allow editing
            if (isCentralBody) {
                const earthConfig = config.bodies.earth;
                // Central body is always at origin with zero velocity
                this.posXInput.value = '0';
                this.posYInput.value = '0';
                this.posZInput.value = '0';
                this.velXInput.value = '0';
                this.velYInput.value = '0';
                this.velZInput.value = '0';
                this.massInput.value = earthConfig.mass.toString();
                
                // Clear orbit display for central body
                this.orbitTypeDiv.textContent = 'Orbit Type: N/A (Central Body)';
                this.orbitTypeDiv.style.color = '#FFFFFF';
            }
            return;
        }

        // Enable inputs for orbital bodies
        this.posXInput.disabled = false;
        this.posYInput.disabled = false;
        this.posZInput.disabled = false;
        this.velXInput.disabled = false;
        this.velYInput.disabled = false;
        this.velZInput.disabled = false;
        this.massInput.disabled = false;

        // Get current state of the focused body
        const stateResult = this.simulationController.executeCommand(`GET_STATE ${targetName}`);
        
        if (stateResult.success && stateResult.data) {
            // Update form fields with INITIAL values (for editing)
            const initialPos = stateResult.data.initialPosition || stateResult.data.position;
            const initialVel = stateResult.data.initialVelocity || stateResult.data.velocity;
            
            this.posXInput.value = initialPos[0].toString();
            this.posYInput.value = initialPos[1].toString();
            this.posZInput.value = initialPos[2].toString();
            
            this.velXInput.value = initialVel[0].toString();
            this.velYInput.value = initialVel[1].toString();
            this.velZInput.value = initialVel[2].toString();
            
            // Update mass field
            this.massInput.value = stateResult.data.mass.toString();
        } else {
            // Log error if state retrieval failed
            console.error(`[UIManager] Failed to get state for body '${targetName}':`, stateResult.message || 'Unknown error');
        }

        // Get orbit info for the focused body
        const orbitResult = this.simulationController.executeCommand(`GET_ORBIT_INFO ${targetName}`);
        
        if (orbitResult.success && orbitResult.data) {
            // Get current position and velocity for display
            const stateResult = this.simulationController.executeCommand(`GET_STATE ${targetName}`);
            let altitude: number | undefined;
            let velocity: number | undefined;
            
            if (stateResult.success && stateResult.data) {
                // Use current position/velocity
                const pos = stateResult.data.position;
                const vel = stateResult.data.velocity;
                altitude = Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]);
                velocity = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
            }
            
            this.updateOrbitTypeDisplay({
                type: orbitResult.data.orbitType,
                parameters: orbitResult.data.parameters
            }, altitude, velocity);
        } else {
            // Clear orbit display if we can't get info
            this.orbitTypeDiv.textContent = 'Orbit Type: Unknown';
            this.orbitTypeDiv.style.color = '#FFFFFF';
        }
    }

    /**
     * Format a distance value (in km) with appropriate unit
     */
    private formatDistance(km: number): string {
        const absKm = Math.abs(km);
        
        // Light-day: 1 Ld = 2.59e10 km
        if (absKm >= 1.295e10) {
            return `${(km / 2.59e10).toFixed(2)} Ld`;
        }
        // Light-hour: 1 Lh = 1.08e9 km
        if (absKm >= 5.4e8) {
            return `${(km / 1.08e9).toFixed(2)} Lh`;
        }
        // Light-minute: 1 Lm = 1.8e7 km
        if (absKm >= 9e6) {
            return `${(km / 1.8e7).toFixed(2)} Lm`;
        }
        // Light-second: 1 Ls = 299792.458 km (speed of light * 1 second)
        if (absKm >= 149896.229) {
            return `${(km / 299792.458).toFixed(2)} Ls`;
        }
        // Megameter: 1 Mm = 1e3 km
        if (absKm >= 500) {
            return `${(km / 1e3).toFixed(2)} Mm`;
        }
        // Kilometer: 1 km
        if (absKm >= 0.5) {
            return `${km.toFixed(2)} Km`;
        }
        // Meter: 1 m = 1e-3 km
        if (absKm >= 0.0005) {
            return `${(km * 1e3).toFixed(2)} m`;
        }
        // Centimeter: 1 cm = 1e-5 km
        return `${(km * 1e5).toFixed(2)} cm`;
    }

    /**
     * Format a velocity value (in km/s) with appropriate unit
     */
    private formatVelocity(kmPerS: number): string {
        const absKmPerS = Math.abs(kmPerS);
        
        // For velocity, we'll use km/s, m/s, or cm/s
        // km/s
        if (absKmPerS >= 0.5) {
            return `${kmPerS.toFixed(2)} Km/s`;
        }
        // m/s: 1 m/s = 1e-3 km/s
        if (absKmPerS >= 0.0005) {
            return `${(kmPerS * 1e3).toFixed(2)} m/s`;
        }
        // cm/s: 1 cm/s = 1e-5 km/s
        return `${(kmPerS * 1e5).toFixed(2)} cm/s`;
    }

    /**
     * Update current values display in orbit type div
     */
    private updateCurrentValuesDisplay(): void {
        if (!this.currentFocusedBodyName || this.currentFocusedBodyName === config.bodies.earth.name) {
            if (this.currentFocusedBodyName === config.bodies.earth.name) {
                this.orbitTypeDiv.innerHTML = '<table style="width: 100%; border-collapse: collapse;"><tr><td style="padding: 2px 5px;">Central Body (Earth)</td></tr><tr><td style="padding: 2px 5px;">Position and velocity are fixed at origin</td></tr></table>';
                this.orbitTypeDiv.style.color = '#FFFFFF';
            } else {
                this.orbitTypeDiv.textContent = 'No body focused';
                this.orbitTypeDiv.style.color = '#FFFFFF';
            }
            return;
        }

        const stateResult = this.simulationController.executeCommand(`GET_STATE ${this.currentFocusedBodyName}`);
        
        if (stateResult.success && stateResult.data) {
            // Use current position/velocity
            const pos = stateResult.data.position;
            const vel = stateResult.data.velocity;
            
            // Calculate altitude (distance from origin/central body)
            const altitude = Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]);
            
            // Calculate velocity magnitude
            const velocity = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
            
            // Update orbit display with current values
            if (this.currentOrbitInfo) {
                this.updateOrbitTypeDisplay(this.currentOrbitInfo, altitude, velocity);
            }
        }
    }

    /**
     * Start periodic updates for current values display
     */
    private startCurrentValuesUpdates(targetName: string | null): void {
        // Clear existing interval
        if (this.updateInterval !== null) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Only update if a body is focused (not central body or null)
        if (targetName && targetName !== config.bodies.earth.name) {
            // Update immediately
            this.updateCurrentValuesDisplay();
            
            // Update every 100ms for smooth display
            this.updateInterval = window.setInterval(() => {
                this.updateCurrentValuesDisplay();
            }, 100);
        } else {
            // Clear display for central body or no focus
            this.updateCurrentValuesDisplay();
        }
    }
}
