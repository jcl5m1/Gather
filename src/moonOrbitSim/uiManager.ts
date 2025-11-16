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
    private orbitTypeDiv!: HTMLTableElement; // Changed to table
    private cameraTargetSelect!: HTMLSelectElement; // Changed to select
    private timeScaleValue!: HTMLSpanElement;
    private currentTimeScale: number = 1000;
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
        
        // Initial time scale is now set in initializeUI (default 1000, logarithmic)
        
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

    /**
     * Create a collapsible section (like Unity's Property Inspector)
     */
    private createCollapsibleSection(title: string, defaultExpanded: boolean = false): {
        container: HTMLDivElement;
        header: HTMLDivElement;
        content: HTMLDivElement;
        toggle: () => void;
    } {
        const container = document.createElement('div');
        container.style.cssText = `
            border: 1px solid rgba(255,255,255,0.2);
            margin: 0;
            background: rgba(0,0,0,0.3);
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
            padding: 0px 0px;
            background: rgba(255,255,255,0.1);
            font-weight: bold;
            font-size: 13px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            margin: 0;
        `;
        
        const arrow = document.createElement('span');
        arrow.style.cssText = 'margin-right: 6px; font-size: 10px; width: 12px; display: inline-block;';
        arrow.textContent = defaultExpanded ? '▼' : '▶';
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = title;
        
        header.appendChild(arrow);
        header.appendChild(titleSpan);

        const content = document.createElement('div');
        content.style.cssText = `
            display: ${defaultExpanded ? 'block' : 'none'};
            padding: 0px;
            margin: 0;
        `;

        let isExpanded = defaultExpanded;
        const toggle = () => {
            isExpanded = !isExpanded;
            content.style.display = isExpanded ? 'block' : 'none';
            arrow.textContent = isExpanded ? '▼' : '▶';
        };

        header.addEventListener('click', toggle);

        container.appendChild(header);
        container.appendChild(content);

        return { container, header, content, toggle };
    }

    /**
     * Create a property row (label + value) for tables
     */
    private createPropertyRow(label: string, value: string | HTMLElement, readOnly: boolean = true): HTMLTableRowElement {
        const row = document.createElement('tr');
        row.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); margin: 0; padding: 0;';
        
        const labelCell = document.createElement('td');
        labelCell.style.cssText = `
            padding: 2px 2px;
            width: 40%;
            font-size: 11px;
            color: rgba(255,255,255,0.8);
            margin: 0;
        `;
        labelCell.textContent = label;
        
        const valueCell = document.createElement('td');
        valueCell.style.cssText = `
            padding: 2px 2px;
            font-size: 11px;
            color: rgba(255,255,255,0.95);
            margin: 0;
        `;
        
        if (typeof value === 'string') {
            valueCell.textContent = value;
        } else {
            valueCell.appendChild(value);
        }
        
        row.appendChild(labelCell);
        row.appendChild(valueCell);
        return row;
    }

    /**
     * Create a read-only property display
     */
    private createReadOnlyProperty(label: string, value: string): HTMLTableRowElement {
        return this.createPropertyRow(label, value, true);
    }

    /**
     * Create a read/write property input
     */
    private createReadWriteProperty(label: string, id: string, value: string, step: string): {
        row: HTMLTableRowElement;
        input: HTMLInputElement;
    } {
        const row = document.createElement('tr');
        row.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); margin: 0; padding: 0;';
        
        const labelCell = document.createElement('td');
        labelCell.style.cssText = `
            padding: 2px 2px;
            width: 40%;
            font-size: 11px;
            color: rgba(255,255,255,0.8);
            margin: 0;
        `;
        labelCell.textContent = label;
        
        const valueCell = document.createElement('td');
        valueCell.style.cssText = 'padding: 2px 2px; margin: 0;';
        
        const input = document.createElement('input');
        input.type = 'number';
        input.id = id;
        input.value = value;
        input.step = step;
        input.style.cssText = `
            width: 100%;
            padding: 0px 0 px;
            margin: 0;
            background: rgba(255,255,255,0.1);
            color: white;
            border: 1px solid rgba(255,255,255,0.2);
            font-size: 11px;
            font-family: monospace;
        `;
        
        valueCell.appendChild(input);
        row.appendChild(labelCell);
        row.appendChild(valueCell);
        
        return { row, input };
    }

    /**
     * Create a slider property
     */
    private createSliderProperty(label: string, id: string, min: string, max: string, step: string, value: string): {
        row: HTMLTableRowElement;
        slider: HTMLInputElement;
        valueDisplay: HTMLSpanElement;
    } {
        const row = document.createElement('tr');
        row.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); margin: 0; padding: 0;';
        
        const labelCell = document.createElement('td');
        labelCell.style.cssText = `
            padding: 2px 2px;
            width: 40%;
            font-size: 11px;
            color: rgba(255,255,255,0.8);
            margin: 0;
        `;
        labelCell.textContent = label;
        
        const valueCell = document.createElement('td');
        valueCell.style.cssText = 'padding: 2px 2px; margin: 0;';
        
        const sliderContainer = document.createElement('div');
        sliderContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin: 0;';
        
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = id;
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = value;
        slider.style.cssText = 'flex: 1; margin: 0;';
        
        const valueDisplay = document.createElement('span');
        valueDisplay.style.cssText = `
            min-width: 50px;
            text-align: right;
            font-size: 11px;
            font-family: monospace;
            color: rgba(255,255,255,0.95);
            margin: 0;
        `;
        valueDisplay.textContent = value;
        
        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(valueDisplay);
        valueCell.appendChild(sliderContainer);
        row.appendChild(labelCell);
        row.appendChild(valueCell);
        
        return { row, slider, valueDisplay };
    }

    /**
     * Create a button property
     */
    private createButtonProperty(label: string, buttonText: string, onClick: () => void): HTMLTableRowElement {
        const row = document.createElement('tr');
        row.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); margin: 0; padding: 0;';
        
        const labelCell = document.createElement('td');
        labelCell.style.cssText = `
            padding: 2px 2px;
            width: 40%;
            font-size: 11px;
            color: rgba(255,255,255,0.8);
            margin: 0;
        `;
        labelCell.textContent = label;
        
        const valueCell = document.createElement('td');
        valueCell.style.cssText = 'padding: 0; margin: 0; border: 0;';
        
        const button = document.createElement('button');
        button.textContent = buttonText;
        button.style.cssText = `
            padding: 2px 8px;
            margin: 0;
            background: rgba(100,150,255,0.6);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            cursor: pointer;
            font-size: 11px;
        `;
        button.onclick = onClick;
        
        valueCell.appendChild(button);
        row.appendChild(labelCell);
        row.appendChild(valueCell);
        
        return row;
    }

    /**
     * Create a dropdown property
     */
    private createDropdownProperty(label: string, id: string, options: string[], value: string, onChange: (value: string) => void): {
        row: HTMLTableRowElement;
        select: HTMLSelectElement;
    } {
        const row = document.createElement('tr');
        row.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); margin: 0; padding: 0;';
        
        const labelCell = document.createElement('td');
        labelCell.style.cssText = `
            padding: 2px 2px;
            width: 40%;
            font-size: 11px;
            color: rgba(255,255,255,0.8);
            margin: 0;
        `;
        labelCell.textContent = label;
        
        const valueCell = document.createElement('td');
        valueCell.style.cssText = 'padding: 2px 2px; margin: 0;';
        
        const select = document.createElement('select');
        select.id = id;
        select.style.cssText = `
            width: 100%;
            padding: 0px 0 px;
            margin: 0;
            background: rgba(255,255,255,0.1);
            color: white;
            border: 1px solid rgba(255,255,255,0.2);
            font-size: 11px;
        `;
        
        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option;
            optionElement.textContent = option;
            if (option === value) {
                optionElement.selected = true;
            }
            select.appendChild(optionElement);
        });
        
        select.addEventListener('change', () => onChange(select.value));
        
        valueCell.appendChild(select);
        row.appendChild(labelCell);
        row.appendChild(valueCell);
        
        return { row, select };
    }

    private initializeUI(): void {
        // Create Property Inspector container
        const propertyInspector = document.createElement('div');
        propertyInspector.id = 'propertyInspector';
        propertyInspector.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            width: 300px;
            background: rgba(30,30,30,0.95);
            color: white;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 12px;
            max-height: 90vh;
            overflow-y: auto;
            border: 1px solid rgba(255,255,255,0.2);
            box-shadow: 0 2px 10px rgba(0,0,0,0.5);
            margin: 0;
        `;

        // Title bar
        const titleBar = document.createElement('div');
        titleBar.style.cssText = `
            padding: 2px;
            background: rgba(0,0,0,0.5);
            border-bottom: 1px solid rgba(255,255,255,0.2);
            font-weight: bold;
            font-size: 13px;
            margin: 0;
        `;
        titleBar.textContent = 'Property Inspector';
        propertyInspector.appendChild(titleBar);

        // Initialize with Moon parameters from config
        const moonConfig = config.bodies.moon;
        const earthConfig = config.bodies.earth;
        const moonDistance = moonConfig.distance || 384400;
        const moonVelocity = Math.sqrt(G * earthConfig.mass / moonDistance);

        // Section 1: Orbit Stats (read-only table)
        const orbitSection = this.createCollapsibleSection('Orbit Stats', true);
        const orbitTable = document.createElement('table');
        orbitTable.style.cssText = 'width: 100%; border-collapse: collapse; margin: 0; border-spacing: 0;';
        this.orbitTypeDiv = orbitTable;
        orbitSection.content.appendChild(orbitTable);
        propertyInspector.appendChild(orbitSection.container);

        // Section 3: Initial Parameters (read/write inputs)
        const paramsSection = this.createCollapsibleSection('Initial Parameters', false);
        const paramsTable = document.createElement('table');
        paramsTable.style.cssText = 'width: 100%; border-collapse: collapse; margin: 0; border-spacing: 0;';
        
        const posX = this.createReadWriteProperty('Position X', 'posX', moonDistance.toString(), '1000');
        const posY = this.createReadWriteProperty('Position Y', 'posY', '0', '1000');
        const posZ = this.createReadWriteProperty('Position Z', 'posZ', '0', '1000');
        const velX = this.createReadWriteProperty('Velocity X', 'velX', '0', '0.001');
        const velY = this.createReadWriteProperty('Velocity Y', 'velY', '0', '0.001');
        const velZ = this.createReadWriteProperty('Velocity Z', 'velZ', moonVelocity.toFixed(6), '0.001');
        const mass = this.createReadWriteProperty('Mass', 'mass', moonConfig.mass.toString(), '1e20');

        // Store input references
        this.posXInput = posX.input;
        this.posYInput = posY.input;
        this.posZInput = posZ.input;
        this.velXInput = velX.input;
        this.velYInput = velY.input;
        this.velZInput = velZ.input;
        this.massInput = mass.input;

        paramsTable.appendChild(posX.row);
        paramsTable.appendChild(posY.row);
        paramsTable.appendChild(posZ.row);
        paramsTable.appendChild(velX.row);
        paramsTable.appendChild(velY.row);
        paramsTable.appendChild(velZ.row);
        paramsTable.appendChild(mass.row);
        
        paramsSection.content.appendChild(paramsTable);
        propertyInspector.appendChild(paramsSection.container);

        // Store heading reference for compatibility
        this.bodyParamsHeading = document.createElement('h3');
        this.bodyParamsHeading.textContent = 'Body Parameters';

        // Section 3: Simulation Controls
        const controlsSection = this.createCollapsibleSection('Simulation Controls', true);
        const controlsTable = document.createElement('table');
        controlsTable.style.cssText = 'width: 100%; border-collapse: collapse; margin: 0; border-spacing: 0;';
        
        // Get available bodies for camera dropdown
        const getAvailableBodies = (): string[] => {
            const bodies = ['Free Camera'];
            // Get all bodies from simulation
            const result = this.simulationController.executeCommand('LIST_BODIES');
            if (result.success && result.data && result.data.bodies) {
                bodies.push(...result.data.bodies);
            }
            return bodies;
        };
        
        // Camera Focus Target dropdown
        const cameraDropdown = this.createDropdownProperty(
            'Camera Target',
            'cameraTarget',
            getAvailableBodies(),
            'Free Camera',
            (value) => {
                if (this.cameraManager) {
                    if (value === 'Free Camera') {
                        this.cameraManager.switchToFreeCamera();
                    } else {
                        this.cameraManager.switchToBodyByName(value);
                    }
                }
            }
        );
        // Store camera dropdown reference
        this.cameraTargetSelect = cameraDropdown.select;
        
        // Time scale control with +/- buttons: 1e-6 to 1e10, default 1000
        const timeScaleMin = 1e-6;
        const timeScaleMax = 1e10;
        const defaultTimeScale = 1000;
        this.currentTimeScale = defaultTimeScale;
        
        // Create time scale control row
        const timeScaleRow = document.createElement('tr');
        timeScaleRow.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); margin: 0; padding: 0;';
        
        const labelCell = document.createElement('td');
        labelCell.style.cssText = `
            padding: 2px 2px;
            width: 40%;
            font-size: 11px;
            color: rgba(255,255,255,0.8);
            margin: 0;
        `;
        labelCell.textContent = 'Time Scale';
        
        const valueCell = document.createElement('td');
        valueCell.style.cssText = 'padding: 0; margin: 0; border: 0;';
        
        const timeScaleContainer = document.createElement('div');
        timeScaleContainer.style.cssText = 'display: flex; align-items: center; gap: 4px; margin: 0; padding: 0;';
        
        // Format time scale value for display
        const formatTimeScale = (value: number): string => {
            if (value > 1e3 || value < 1e-3) {
                // Use scientific notation for values >= 1000 or <= 0.001
                return value.toExponential(1) + 'x';
            } else if (value < 1) {
                // Show 3 decimal places for values between 0.001 and 1
                return value.toFixed(3) + 'x';
            } else {
                // Use regular notation (no decimals) for values between 1 and 1000
                return value.toFixed(0) + 'x';
            }
        };
        
        // Decrease button (-)
        const decreaseButton = document.createElement('button');
        decreaseButton.textContent = '-';
        decreaseButton.style.cssText = `
            padding: 2px 6px;
            margin: 0;
            background: rgba(100,150,255,0.6);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            min-width: 24px;
        `;
        
        // Value display
        const valueDisplay = document.createElement('span');
        valueDisplay.id = 'timeScaleValue';
        valueDisplay.style.cssText = `
            min-width: 60px;
            text-align: center;
            font-size: 11px;
            font-family: monospace;
            color: rgba(255,255,255,0.95);
            margin: 0;
        `;
        valueDisplay.textContent = formatTimeScale(defaultTimeScale);
        this.timeScaleValue = valueDisplay;
        
        // Increase button (+)
        const increaseButton = document.createElement('button');
        increaseButton.textContent = '+';
        increaseButton.style.cssText = `
            padding: 2px 6px;
            margin: 0;
            background: rgba(100,150,255,0.6);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            min-width: 24px;
        `;
        
        // Button click handlers
        const updateTimeScale = (multiplier: number) => {
            const newValue = this.currentTimeScale * multiplier;
            // Clamp to valid range
            const clampedValue = Math.max(timeScaleMin, Math.min(timeScaleMax, newValue));
            this.currentTimeScale = clampedValue;
            this.timeScaleValue.textContent = formatTimeScale(clampedValue);
            this.executeAndDisplayCommand(`SET_TIME_SCALE ${clampedValue}`);
        };
        
        decreaseButton.onclick = () => updateTimeScale(0.1); // Divide by 10
        increaseButton.onclick = () => updateTimeScale(10); // Multiply by 10
        
        timeScaleContainer.appendChild(decreaseButton);
        timeScaleContainer.appendChild(valueDisplay);
        timeScaleContainer.appendChild(increaseButton);
        valueCell.appendChild(timeScaleContainer);
        timeScaleRow.appendChild(labelCell);
        timeScaleRow.appendChild(valueCell);
        
        // Set initial time scale
        this.simulationController.executeCommand(`SET_TIME_SCALE ${defaultTimeScale}`);
        
        const resetButton = this.createButtonProperty('Reset', 'Reset Simulation', () => this.resetSimulation());
        
        controlsTable.appendChild(cameraDropdown.row);
        controlsTable.appendChild(timeScaleRow);
        controlsTable.appendChild(resetButton);
        
        controlsSection.content.appendChild(controlsTable);
        propertyInspector.appendChild(controlsSection.container);

        document.body.appendChild(propertyInspector);

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
            padding: 2px;
            background: rgba(255,255,255,0.1);
            color: white;
            border: 1px solid #666;
            font-family: monospace;
            font-size: 12px;
        `;
        
        const commandButton = document.createElement('button');
        commandButton.textContent = 'Execute';
        commandButton.style.cssText = `
            padding: 2px 4px;
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
            padding: 2px;
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
        // Time scale buttons are handled in initializeUI

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
                    this.currentTimeScale = timeScale;
                    // Format display appropriately
                    if (timeScale >= 1e3 || timeScale <= 1e-3) {
                        this.timeScaleValue.textContent = timeScale.toExponential(2) + 'x';
                    } else if (timeScale < 1) {
                        this.timeScaleValue.textContent = timeScale.toFixed(3) + 'x';
                    } else {
                        this.timeScaleValue.textContent = timeScale.toFixed(0) + 'x';
                    }
                }
                
                // Update camera dropdown options
                this.updateCameraDropdownOptions();
                
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
        
        if (!this.orbitTypeDiv) return;
        
        // Clear existing rows
        this.orbitTypeDiv.innerHTML = '';
        
        // Add rows based on orbit type
        if (orbitInfo.type === 'elliptical' && orbitInfo.parameters) {
            this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Orbit Type', 'Elliptical'));
            this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Semi-major axis', this.formatDistance(orbitInfo.parameters.a)));
            this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Eccentricity', orbitInfo.parameters.e.toFixed(3)));
            this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Periapsis', this.formatDistance(orbitInfo.parameters.periapsis)));
            this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Apoapsis', this.formatDistance(orbitInfo.parameters.apoapsis)));
        } else if (orbitInfo.type === 'hyperbolic') {
            this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Orbit Type', 'Hyperbolic'));
        } else {
            this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Orbit Type', 'Parabolic'));
        }
        
        // Add current altitude and velocity
        if (currentAltitude !== undefined && currentVelocity !== undefined) {
            this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Altitude', this.formatDistance(currentAltitude)));
            this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Velocity', this.formatVelocity(currentVelocity)));
        }
    }

    /**
     * Update camera target display
     */
    updateCameraTargetDisplay(targetName: string | null): void {
        if (this.cameraTargetSelect) {
            const value = targetName === null ? 'Free Camera' : targetName;
            this.cameraTargetSelect.value = value;
            // If the value doesn't exist in options, add it
            if (!Array.from(this.cameraTargetSelect.options).some(opt => opt.value === value)) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = value;
                this.cameraTargetSelect.appendChild(option);
            }
        }
    }

    /**
     * Update available bodies in camera dropdown
     */
    private updateCameraDropdownOptions(): void {
        if (!this.cameraTargetSelect) return;
        
        // Get current selection
        const currentValue = this.cameraTargetSelect.value;
        
        // Get all bodies from simulation
        const result = this.simulationController.executeCommand('LIST_BODIES');
        const bodies: string[] = ['Free Camera'];
        
        if (result.success && result.data && result.data.bodies) {
            bodies.push(...result.data.bodies);
        }
        
        // Clear and rebuild options
        this.cameraTargetSelect.innerHTML = '';
        bodies.forEach(bodyName => {
            const option = document.createElement('option');
            option.value = bodyName;
            option.textContent = bodyName;
            if (bodyName === currentValue) {
                option.selected = true;
            }
            this.cameraTargetSelect.appendChild(option);
        });
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
        if (!this.orbitTypeDiv) return;
        
        if (!this.currentFocusedBodyName || this.currentFocusedBodyName === config.bodies.earth.name) {
            this.orbitTypeDiv.innerHTML = '';
            if (this.currentFocusedBodyName === config.bodies.earth.name) {
                this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Body', 'Central Body (Earth)'));
                this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Status', 'Position and velocity are fixed at origin'));
            } else {
                this.orbitTypeDiv.appendChild(this.createReadOnlyProperty('Status', 'No body focused'));
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
