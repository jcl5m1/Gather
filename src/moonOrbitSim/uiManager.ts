import { SimulationController } from './simulationController';
import { CameraManager } from './cameraManager';
import { config, G } from './config';
import { gravitationalConstantUnit } from './units';
import { kilometers, kilograms, Length, Velocity, Time, Mass, formatDistanceWithAstronomicalUnits, formatVelocity, formatTime, GenericMeasure } from './units';
import * as THREE from 'three';

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

/**
 * Interface for UI sections in the Property Inspector
 * Each section is self-contained with all elements needed for rendering
 */
interface UISection {
    id: string;                                    // Unique identifier for the section
    title: string;                                 // Section title (can be dynamic)
    container: HTMLDivElement;                     // Main container element
    header: HTMLDivElement;                        // Header element (for collapsible sections)
    headerTitle: HTMLSpanElement;                  // Title span within header (for dynamic title updates)
    content: HTMLDivElement;                       // Content container
    contentContainer?: HTMLDivElement;             // Optional inner container for dynamic content (e.g., trajectory)
    getObject?: () => any;                         // Optional function to get the object to display (for dynamic sections)
    emptyMessage?: string;                        // Optional message to show when object is null/undefined
    // Section-specific elements (optional, based on section type)
    cameraFocusSelect?: HTMLSelectElement;        // For Camera section
    timeScaleValue?: HTMLSpanElement;             // For Simulation section
    isEditable?: boolean;                         // Whether this section should use editable inputs
}

export class UIManager {
    private simulationController: SimulationController;
    private cameraManager?: CameraManager;
    private sections: UISection[] = [];           // Array of all UI sections
    private currentTimeScale: number = 0; // Will be initialized from gameLoop in initializeUI
    private commandInput!: HTMLInputElement;
    private commandOutput!: HTMLDivElement;
    private bodyParamsHeading!: HTMLHeadingElement;
    private currentFocusedBodyName: string | null = null;
    private updateInterval: number | null = null;
    private gameLoopUpdateFrameId: number = 0;

    constructor(simulationController: SimulationController, cameraManager?: CameraManager) {
        this.simulationController = simulationController;
        this.cameraManager = cameraManager;
        this.initializeUI();
        this.setupEventListeners();
        
        // Initial time scale is now set in initializeUI (default 1000, logarithmic)
        
        // Setup camera target change callback for focused body updates
        // Camera section is now auto-generated and will update via updateAllSections()
        if (this.cameraManager) {
            this.cameraManager.setOnTargetChange((targetName) => {
                this.updateFormForFocusedBody(targetName);
                this.startCurrentValuesUpdates(targetName);
                // Update all sections to refresh camera dropdown
                this.updateAllSections();
            });
            // Set initial display
            const initialTarget = this.cameraManager.getCurrentTargetName();
            this.updateFormForFocusedBody(initialTarget);
            this.startCurrentValuesUpdates(initialTarget);
        }
        
        // Don't reset simulation here - let app.ts initialize the Moon first
        // The UI fields are already initialized with Moon parameters
        
        // Start frame-by-frame updates for GameLoop section
        this.startGameLoopSectionUpdates();
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
        arrow.innerHTML = defaultExpanded ? '&#9660;' : '&#9654;';
        
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
            arrow.innerHTML = isExpanded ? '&#9660;' : '&#9654;';
        };

        header.addEventListener('click', toggle);

        container.appendChild(header);
        container.appendChild(content);

        return { container, header, content, toggle };
    }

    /**
     * Helper function to create a standard UI section with all common setup
     * This simplifies the initialization of UI sections in initializeUI
     * Title is automatically extracted from the object's class name
     * Empty message is auto-generated from the class name
     */
    private createUISection(
        getObject: () => any,
        defaultExpanded: boolean,
        propertyInspector: HTMLDivElement,
        isEditable: boolean = false
    ): UISection {
        // Get the object to determine its class name for the title
        const obj = getObject();
        const className = obj ? this.getClassName(obj) : 'Unknown';
        
        // Extract ID from class name by normalizing it (lowercase, remove spaces)
        const id = className.toLowerCase().replace(/\s+/g, '');
        
        // Auto-generate empty message from class name
        const emptyMessage = `No ${className} available`;
        
        const section = this.createCollapsibleSection(className, defaultExpanded);
        const contentContainer = document.createElement('div');
        contentContainer.style.cssText = 'width: 100%; margin: 0;';
        section.content.appendChild(contentContainer);
        propertyInspector.appendChild(section.container);
        
        // Extract header title span (second span is the title, first is the arrow)
        const titleSpans = section.header.querySelectorAll('span');
        const headerTitle = titleSpans.length > 1 ? titleSpans[1] as HTMLSpanElement : titleSpans[0] as HTMLSpanElement;
        
        return {
            id: id,
            title: className,
            container: section.container,
            header: section.header,
            headerTitle: headerTitle,
            content: section.content,
            contentContainer: contentContainer,
            getObject: getObject,
            emptyMessage: emptyMessage,
            isEditable: isEditable
        };
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
     * Format a camelCase variable name into a readable label
     * Examples: "cameraFocus" -> "Camera Focus", "posX" -> "Pos X", "timeScale" -> "Time Scale"
     */
    private formatLabelFromVariableName(variableName: string): string {
        // Handle empty or single character
        if (!variableName || variableName.length <= 1) {
            return variableName;
        }
        
        // Split camelCase into words
        const words: string[] = [];
        let currentWord = variableName[0].toUpperCase();
        
        for (let i = 1; i < variableName.length; i++) {
            const char = variableName[i];
            // If uppercase, start a new word
            if (char === char.toUpperCase() && char !== char.toLowerCase()) {
                if (currentWord) {
                    words.push(currentWord);
                }
                currentWord = char;
            } else {
                currentWord += char;
            }
        }
        
        if (currentWord) {
            words.push(currentWord);
        }
        
        return words.join(' ');
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
        const moonBody = config.bodies.moon;
        const earthBody = config.bodies.earth;
        const moonDistance = (moonBody.data && moonBody.data.distance) || 384400;
        const earthMass = earthBody.mass;
        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const moonVelocity = Math.sqrt(GValue * earthMass / moonDistance);

        // Section 0: CameraManager (auto-generated from CameraManager object)
        this.sections.push(this.createUISection(
            () => this.simulationController.getGameLoop().getCameraManager(),
            true,
            propertyInspector,
            true
        ));

        // Section 1: Dynamically generated from focused object's trajectory property
        // Title will be updated to the actual class name via introspection
        this.sections.push(this.createUISection(
            () => this.currentFocusedBodyName 
                ? this.simulationController.getTrajectory(this.currentFocusedBodyName)
                : null,
            true,
            propertyInspector
        ));

        // Section 2: Initial Parameters (dynamically generated from orbital body)
        this.sections.push(this.createUISection(
            () => this.currentFocusedBodyName 
                ? this.simulationController.getBody(this.currentFocusedBodyName)
                : null,
            false,
            propertyInspector,
            true
        ));

        // Store heading reference for compatibility
        this.bodyParamsHeading = document.createElement('h3');
        this.bodyParamsHeading.textContent = 'Body Parameters';

        // Section 3: GameLoop (auto-generated from GameLoop object)
        this.sections.push(this.createUISection(
            () => this.simulationController.getGameLoop(),
            true,
            propertyInspector,
            true
        ));
        
        // Initialize time scale from gameLoop (which loads from config.json)
        const gameLoop = this.simulationController.getGameLoop();
        this.currentTimeScale = gameLoop.getTimeScale();

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
        // Input field listeners are now handled directly in generateEditablePropertySection

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
            } else if (event.key === ' ') {
                event.preventDefault();
                // Space key triggers ADD_BODY 50 times (with random values)
                for (let i = 0; i < 50; i++) {
                    this.executeAndDisplayCommand('ADD_BODY');
                }
            } else if (event.key === 'h' || event.key === 'H') {
                event.preventDefault();
                // H key toggles trajectory visibility
                const gameLoop = this.simulationController.getGameLoop();
                gameLoop.toggleTrajectoryVisibility();
                const visible = gameLoop.getTrajectoriesVisible();
                console.log(`Trajectories ${visible ? 'shown' : 'hidden'}`);
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
                }
                
                // Update all UI sections (camera dropdown and game loop will refresh automatically)
                this.updateAllSections();
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

        // If command was RESET, update all UI sections
        if (command.toUpperCase().startsWith('RESET')) {
            if (result.success) {
                this.updateAllSections();
            }
        }

        // If command was ADD_BODY, REMOVE_BODY, or camera-related, update all sections
        // This will refresh the auto-generated camera dropdown with new options
        if (command.toUpperCase().startsWith('ADD_BODY') || 
            command.toUpperCase().startsWith('REMOVE_BODY') ||
            command.toUpperCase().startsWith('SET_CAMERA_FOCUS') || 
            command.toUpperCase().startsWith('CAMERA_FOCUS')) {
            if (result.success) {
                this.updateAllSections();
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

    /**
     * Get public properties from an object using property descriptor introspection
     * This method uses introspection to discover all public properties of an object
     * Properties starting with underscore are considered private and are excluded
     */
    private getPublicProperties(obj: any): { [key: string]: any } {
        const props: { [key: string]: any } = {};
        
        if (!obj) return props;
        
        // Get ALL own property names (including non-enumerable)
        const allPropertyNames = Object.getOwnPropertyNames(obj);
        
        // Also get enumerable properties from Object.keys
        const enumerableKeys = Object.keys(obj);
        
        // Combine and deduplicate
        const allKeys = [...new Set([...allPropertyNames, ...enumerableKeys])];
        
        for (const key of allKeys) {
            // Skip functions
            if (typeof obj[key] === 'function') {
                continue;
            }
            
            // Skip properties starting with underscore (convention for private members)
            if (key.startsWith('_')) {
                continue;
            }
            
            // Get property descriptor to analyze the property
            let descriptor: PropertyDescriptor | undefined;
            try {
                descriptor = Object.getOwnPropertyDescriptor(obj, key);
            } catch (e) {
                continue;
            }
            
            // Skip if property doesn't exist or can't be accessed
            if (!descriptor) {
                continue;
            }
            
            // Skip non-enumerable properties that are likely internal
            // Exception: allow enumerable data properties
            if (!descriptor.enumerable) {
                // If it's a getter/setter without enumerable flag, likely private
                if (descriptor.get || descriptor.set) {
                    continue;
                }
                // If it's a non-enumerable data property, it might be intentionally hidden
                if (descriptor.value === undefined) {
                    continue;
                }
            }
            
            // Skip if it's a getter-only property without a setter (might be read-only/internal)
            if (descriptor.get && !descriptor.set && descriptor.enumerable === false) {
                continue;
            }
            
            try {
                const value = obj[key];
                
                // Skip if it's a THREE.js internal object
                if (value !== null && typeof value === 'object') {
                    if (value.isObject3D || value.isScene || value.isMesh || value.isLine || 
                        value.isMaterial || value.isGeometry || value.isBufferGeometry) {
                        continue;
                    }
                }
                
                // Skip common internal properties that shouldn't be displayed
                const commonInternalProps = [
                    'constructor', 'prototype', '__proto__', 'toString', 'valueOf',
                    'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
                    'toLocaleString', 'toJSON'
                ];
                if (commonInternalProps.includes(key)) {
                    continue;
                }
                
                props[key] = value;
            } catch (e) {
                // If we can't access the property, skip it
                continue;
            }
        }
        
        return props;
    }

    /**
     * Get class name from an object instance
     */
    private getClassName(obj: any): string {
        if (obj && obj.constructor && obj.constructor.name) {
            return obj.constructor.name;
        }
        return 'Unknown';
    }

    /**
     * Generate input fields for editable properties (Vector3 and number types)
     * This creates input fields that directly update the object's properties
     */
    private generateEditablePropertySection(obj: any, container: HTMLDivElement): void {
        if (!obj || !container) return;

        // Check if this is the central body or no body is focused
        const isCentralBody = this.currentFocusedBodyName === config.bodies.earth.name;
        const shouldDisable = !this.currentFocusedBodyName || isCentralBody;

        // Check if any input in the container has focus - if so, don't regenerate
        const activeElement = document.activeElement;
        const hasFocusedInput = container.contains(activeElement) && 
                                 (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLSelectElement);
        
        if (hasFocusedInput) {
            // Don't regenerate if user is typing - just update non-focused inputs
            // Update existing input values without recreating them
            const existingInputs = container.querySelectorAll('input[type="number"]');
            existingInputs.forEach((input: Element) => {
                const htmlInput = input as HTMLInputElement;
                if (htmlInput !== activeElement && htmlInput.id) {
                    // Extract property name from id (might be "key" or "key.x", "key.y", "key.z")
                    const idParts = htmlInput.id.split('.');
                    const key = idParts[0];
                    if (key in obj) {
                        if (idParts.length === 1) {
                            // Simple property
                            const currentValue = obj[key];
                            if (typeof currentValue === 'number' && parseFloat(htmlInput.value) !== currentValue) {
                                htmlInput.value = this.formatNumber(currentValue);
                            }
                        } else if (idParts.length === 2 && obj[key] instanceof THREE.Vector3) {
                            // Vector3 component
                            const vec = obj[key] as THREE.Vector3;
                            const component = idParts[1] as 'x' | 'y' | 'z';
                            const currentValue = vec[component];
                            if (parseFloat(htmlInput.value) !== currentValue) {
                                htmlInput.value = this.formatNumber(currentValue);
                            }
                        }
                    }
                }
            });
            return; // Don't regenerate the section
        }

        // Clear existing content
        container.innerHTML = '';

        // Create table for property rows
        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; margin: 0; border-spacing: 0;';

        // Get public properties using introspection
        const publicProps = this.getPublicProperties(obj);

        // Sort keys for consistent display order
        const sortedKeys = Object.keys(publicProps).sort();

        // Generate input fields for each editable property
        for (const key of sortedKeys) {
            const value = publicProps[key];
            
            // Handle dropdown properties: object with { value, options } structure
            if (value !== null && typeof value === 'object' && 
                'value' in value && 'options' in value && 
                Array.isArray(value.options)) {
                const dropdownValue = value as { value: any; options: any[] };
                
                // Create a single row with label and dropdown
                const row = document.createElement('tr');
                row.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); margin: 0; padding: 0;';
                
                // Label cell
                const labelCell = document.createElement('td');
                labelCell.style.cssText = `
                    padding: 2px 2px;
                    width: 40%;
                    font-size: 11px;
                    color: rgba(255,255,255,0.8);
                    margin: 0;
                `;
                labelCell.textContent = this.formatLabelFromVariableName(key);
                
                // Value cell with dropdown
                const valueCell = document.createElement('td');
                valueCell.style.cssText = 'padding: 2px 2px; margin: 0;';
                
                const select = document.createElement('select');
                select.id = key;
                select.disabled = shouldDisable;
                select.style.cssText = `
                    width: 100%;
                    padding: 0px 2px;
                    margin: 0;
                    background: rgba(255,255,255,0.1);
                    color: white;
                    border: 1px solid rgba(255,255,255,0.2);
                    font-size: 11px;
                    font-family: monospace;
                `;
                
                // Populate dropdown with options
                dropdownValue.options.forEach((option, index) => {
                    const optionElement = document.createElement('option');
                    // Handle different option types
                    let optionText: string;
                    let optionValue: string;
                    
                    if (option === null) {
                        optionText = 'Free Camera';
                        optionValue = String(index);
                    } else if (typeof option === 'object' && option !== null) {
                        // If it's an object (like OrbitalBody), try to get a name property or use getName()
                        if (typeof (option as any).getName === 'function') {
                            optionText = (option as any).getName();
                        } else if ('name' in option) {
                            optionText = String((option as any).name);
                        } else {
                            optionText = `Body ${index}`;
                        }
                        optionValue = String(index);
                    } else {
                        // Primitive value
                        optionText = String(option);
                        optionValue = String(option);
                    }
                    
                    optionElement.value = optionValue;
                    optionElement.textContent = optionText;
                    
                    // Check if this option matches the current value
                    // Value can be a number (index) or the option itself
                    const currentValue = dropdownValue.value;
                    if (typeof currentValue === 'number') {
                        if (index === currentValue) {
                            optionElement.selected = true;
                        }
                    } else if (option === currentValue || String(option) === String(currentValue)) {
                        optionElement.selected = true;
                    }
                    
                    select.appendChild(optionElement);
                });
                
                // Handle change event
                select.addEventListener('change', () => {
                    // Get the selected index from the option value
                    const selectedIndex = parseInt(select.value, 10);
                    const newValue = isNaN(selectedIndex) ? select.value : selectedIndex;
                    
                    // Update the property - preserve options and update value
                    try {
                        // Get fresh options in case they've changed (e.g., new bodies added)
                        const currentProperty = obj[key];
                        const updatedOptions = (currentProperty && currentProperty.options) ? currentProperty.options : dropdownValue.options;
                        obj[key] = { value: newValue, options: updatedOptions };
                        
                        // If this is CameraManager's cameraFocus property, apply the change
                        const className = this.getClassName(obj);
                        if (className === 'CameraManager' && key === 'cameraFocus' && typeof obj.applyCameraFocusChange === 'function') {
                            obj.applyCameraFocusChange();
                        }
                    } catch (e) {
                        // If direct assignment fails, try calling a setter
                        console.warn(`Could not set ${key} property:`, e);
                    }
                });
                
                valueCell.appendChild(select);
                row.appendChild(labelCell);
                row.appendChild(valueCell);
                table.appendChild(row);
                continue;
            }
            
            // Handle THREE.Vector3 - create inputs for x, y, z on a single row
            if (value instanceof THREE.Vector3) {
                const vec = value as THREE.Vector3;
                const step = key.includes('velocity') || key.includes('vel') ? '0.001' : '1000';
                
                // Create a single row with label and three inputs (X, Y, Z) side by side
                const row = document.createElement('tr');
                row.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); margin: 0; padding: 0;';
                
                // Label cell
                const labelCell = document.createElement('td');
                labelCell.style.cssText = `
                    padding: 2px 2px;
                    width: 40%;
                    font-size: 11px;
                    color: rgba(255,255,255,0.8);
                    margin: 0;
                `;
                labelCell.textContent = this.formatLabelFromVariableName(key);
                
                // Value cell with three inputs
                const valueCell = document.createElement('td');
                valueCell.style.cssText = 'padding: 2px 2px; margin: 0;';
                
                const inputsContainer = document.createElement('div');
                inputsContainer.style.cssText = 'display: flex; gap: 4px; align-items: center; margin: 0;';
                
                // X input
                const xInput = document.createElement('input');
                xInput.type = 'number';
                xInput.id = `${key}.x`;
                xInput.value = this.formatNumber(vec.x);
                xInput.step = step;
                xInput.disabled = shouldDisable;
                xInput.placeholder = 'X';
                xInput.style.cssText = `
                    flex: 1;
                    padding: 0px 2px;
                    margin: 0;
                    background: rgba(255,255,255,0.1);
                    color: white;
                    border: 1px solid rgba(255,255,255,0.2);
                    font-size: 11px;
                    font-family: monospace;
                `;
                xInput.addEventListener('change', () => {
                    const numValue = parseFloat(xInput.value);
                    if (!isNaN(numValue)) {
                        vec.x = numValue;
                        this.updateBodyFromObject(obj);
                    }
                });
                
                // Y input
                const yInput = document.createElement('input');
                yInput.type = 'number';
                yInput.id = `${key}.y`;
                yInput.value = this.formatNumber(vec.y);
                yInput.step = step;
                yInput.disabled = shouldDisable;
                yInput.placeholder = 'Y';
                yInput.style.cssText = `
                    flex: 1;
                    padding: 0px 2px;
                    margin: 0;
                    background: rgba(255,255,255,0.1);
                    color: white;
                    border: 1px solid rgba(255,255,255,0.2);
                    font-size: 11px;
                    font-family: monospace;
                `;
                yInput.addEventListener('change', () => {
                    const numValue = parseFloat(yInput.value);
                    if (!isNaN(numValue)) {
                        vec.y = numValue;
                        this.updateBodyFromObject(obj);
                    }
                });
                
                // Z input
                const zInput = document.createElement('input');
                zInput.type = 'number';
                zInput.id = `${key}.z`;
                zInput.value = this.formatNumber(vec.z);
                zInput.step = step;
                zInput.disabled = shouldDisable;
                zInput.placeholder = 'Z';
                zInput.style.cssText = `
                    flex: 1;
                    padding: 0px 2px;
                    margin: 0;
                    background: rgba(255,255,255,0.1);
                    color: white;
                    border: 1px solid rgba(255,255,255,0.2);
                    font-size: 11px;
                    font-family: monospace;
                `;
                zInput.addEventListener('change', () => {
                    const numValue = parseFloat(zInput.value);
                    if (!isNaN(numValue)) {
                        vec.z = numValue;
                        this.updateBodyFromObject(obj);
                    }
                });
                
                inputsContainer.appendChild(xInput);
                inputsContainer.appendChild(yInput);
                inputsContainer.appendChild(zInput);
                valueCell.appendChild(inputsContainer);
                
                row.appendChild(labelCell);
                row.appendChild(valueCell);
                table.appendChild(row);
            }
            // Handle number types
            else if (typeof value === 'number') {
                const className = this.getClassName(obj);
                const step = key === 'mass' ? '1e20' : (key === 'timeScale' ? '1' : '0.001');
                
                const numInput = this.createReadWriteProperty(
                    this.formatLabelFromVariableName(key),
                    key,
                    this.formatNumber(value),
                    step
                );
                numInput.input.disabled = shouldDisable;
                numInput.input.addEventListener('change', () => {
                    const numValue = parseFloat(numInput.input.value);
                    if (!isNaN(numValue)) {
                        // Handle different object types
                        if (className === 'GameLoop' && key === 'timeScale') {
                            // Update time scale via command (don't set property directly)
                            this.executeAndDisplayCommand(`SET_TIME_SCALE ${numValue}`);
                        } else if (className === 'OrbitalBody') {
                            // For OrbitalBody, send RESET command with the new value
                            // This ensures proper updates including mesh regeneration for radius
                            this.updateBodyFromObjectWithValue(obj, key, numValue);
                        } else {
                            // For other objects, set the property directly
                            obj[key] = numValue;
                        }
                    }
                });
                table.appendChild(numInput.row);
            }
            // Handle string types
            else if (typeof value === 'string') {
                const className = this.getClassName(obj);
                
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
                labelCell.textContent = this.formatLabelFromVariableName(key);
                
                const valueCell = document.createElement('td');
                valueCell.style.cssText = 'padding: 2px 2px; margin: 0;';
                
                const textInput = document.createElement('input');
                textInput.type = 'text';
                textInput.id = key;
                textInput.value = value;
                textInput.disabled = shouldDisable;
                textInput.style.cssText = `
                    width: 100%;
                    padding: 0px 2px;
                    margin: 0;
                    background: rgba(255,255,255,0.1);
                    color: white;
                    border: 1px solid rgba(255,255,255,0.2);
                    font-size: 11px;
                    font-family: monospace;
                `;
                textInput.addEventListener('change', () => {
                    obj[key] = textInput.value;
                    if (className === 'OrbitalBody') {
                        this.updateBodyFromObject(obj);
                    }
                });
                
                valueCell.appendChild(textInput);
                row.appendChild(labelCell);
                row.appendChild(valueCell);
                table.appendChild(row);
            }
        }

        container.appendChild(table);
    }

    /**
     * Update the body in the simulation when object properties change
     */
    private updateBodyFromObject(body: any): void {
        if (!this.currentFocusedBodyName || !body) return;
        
        // Get the central body mass for trajectory recalculation
        const centralBody = this.simulationController.getGameLoop().getCentralBody();
        const centralMass = centralBody.getMass();
        
        // Update the body using RESET command with new values
        const pos = body.initialPosition;
        const vel = body.initialVelocity;
        const mass = body.mass;
        const radius = body.radius;
        
        const command = `RESET position:${pos.x},${pos.y},${pos.z} velocity:${vel.x},${vel.y},${vel.z} mass:${mass} radius:${radius} bodyId:${this.currentFocusedBodyName}`;
        this.executeAndDisplayCommand(command);
    }

    /**
     * Update a specific property of the body in the simulation
     * Used when a single property is changed in the UI
     */
    private updateBodyFromObjectWithValue(body: any, propertyKey: string, newValue: number): void {
        if (!this.currentFocusedBodyName || !body) return;
        
        // Get current values, but use newValue for the changed property
        const pos = body.initialPosition;
        const vel = body.initialVelocity;
        const mass = propertyKey === 'mass' ? newValue : body.mass;
        const radius = propertyKey === 'radius' ? newValue : body.radius;
        
        const command = `RESET position:${pos.x},${pos.y},${pos.z} velocity:${vel.x},${vel.y},${vel.z} mass:${mass} radius:${radius} bodyId:${this.currentFocusedBodyName}`;
        this.executeAndDisplayCommand(command);
    }

    /**
     * Generate a property section table from any object using introspection
     * This is the core method for dynamically generating property inspector sections
     */
    private generatePropertySectionFromObject(obj: any, container: HTMLDivElement): void {
        if (!obj || !container) return;

        // Clear existing content
        container.innerHTML = '';

        // Create table for property rows
        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; margin: 0; border-spacing: 0;';

        // Get public properties using introspection
        const publicProps = this.getPublicProperties(obj);

        // Sort keys for consistent display order
        const sortedKeys = Object.keys(publicProps).sort();

        // Generate property rows for each public property
        for (const key of sortedKeys) {
            const value = publicProps[key];
            
            // Handle nested objects (like parameters)
            if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof THREE.Vector3)) {
                // Check if the value itself is a Measure - if so, format it directly instead of recursing
                if (this.isMeasure(value)) {
                    const formattedValue = this.formatValueForDisplay(key, value);
                    table.appendChild(this.createReadOnlyProperty(
                        this.formatLabelFromVariableName(key),
                        formattedValue
                    ));
                } else {
                    // For nested objects, display their properties individually
                    const nestedProps = this.getPublicProperties(value);
                    const nestedKeys = Object.keys(nestedProps).sort();
                    
                    for (const nestedKey of nestedKeys) {
                        const nestedValue = nestedProps[nestedKey];
                        // Check if nested value is a Measure - format it directly
                        if (this.isMeasure(nestedValue)) {
                            const formattedValue = this.formatValueForDisplay(nestedKey, nestedValue);
                            table.appendChild(this.createReadOnlyProperty(
                                this.formatLabelFromVariableName(`${key}.${nestedKey}`),
                                formattedValue
                            ));
                        }
                        // Skip THREE.Vector3 objects (they're complex and handled specially if needed)
                        else if (nestedValue instanceof THREE.Vector3) {
                            const vec = nestedValue as THREE.Vector3;
                            const formattedValue = `(${this.formatNumber(vec.x)}, ${this.formatNumber(vec.y)}, ${this.formatNumber(vec.z)})`;
                            table.appendChild(this.createReadOnlyProperty(
                                this.formatLabelFromVariableName(`${key}.${nestedKey}`),
                                formattedValue
                            ));
                        } else {
                            const formattedValue = this.formatValueForDisplay(nestedKey, nestedValue);
                            table.appendChild(this.createReadOnlyProperty(
                                this.formatLabelFromVariableName(`${key}.${nestedKey}`),
                                formattedValue
                            ));
                        }
                    }
                }
            } else {
                // Display simple properties
                const formattedValue = this.formatValueForDisplay(key, value);
                table.appendChild(this.createReadOnlyProperty(
                    this.formatLabelFromVariableName(key),
                    formattedValue
                ));
            }
        }

        container.appendChild(table);
    }

    /**
     * Check if a value is a safe-units Measure type
     */
    private isMeasure(value: any): value is GenericMeasure<number, any, any> {
        return value !== null && 
               value !== undefined && 
               typeof value === 'object' && 
               'value' in value && 
               'unit' in value &&
               'unitSystem' in value;
    }

    /**
     * Get unit dimensions from a measure
     */
    private getUnitDimensions(measure: GenericMeasure<number, any, any>): { length: number; mass: number; time: number } {
        const unit = measure.unit as any;
        return {
            length: unit?.length || 0,
            mass: unit?.mass || 0,
            time: unit?.time || 0
        };
    }

    /**
     * Format a value for display based on its type
     * Uses safe-units type introspection instead of hardcoded key names
     */
    private formatValueForDisplay(key: string, value: any): string {
        if (value === null || value === undefined) {
            return 'N/A';
        }
        
        // Check if value is a safe-units Measure type
        if (this.isMeasure(value)) {
            const measure: GenericMeasure<number, any, any> = value;
            const dims = this.getUnitDimensions(measure);
            
            // Use unit dimensions to determine formatting
            // Length: length=1, mass=0, time=0
            if (dims.length === 1 && dims.mass === 0 && dims.time === 0) {
                return formatDistanceWithAstronomicalUnits(measure as Length);
            }
            // Velocity: length=1, mass=0, time=-1
            if (dims.length === 1 && dims.mass === 0 && dims.time === -1) {
                return formatVelocity(measure as Velocity);
            }
            // Time: length=0, mass=0, time=1
            if (dims.length === 0 && dims.mass === 0 && dims.time === 1) {
                return formatTime(measure as Time);
            }
            // For other measure types, format with 3 decimal places
            if (!isFinite(measure.value)) {
                return measure.value === Infinity ? '∞' : 'NaN';
            }
            // Use toString() to get the formatted string with units, then replace the number part
            const str = measure.toString();
            const absValue = Math.abs(measure.value);
            let formattedNumber: string;
            if (absValue >= 0.001 && absValue < 1e6) {
                formattedNumber = measure.value.toFixed(3);
            } else {
                formattedNumber = measure.value.toExponential(3);
            }
            // Replace the number part in the string (handles both "123.456 unit" and "123.456unit" formats)
            return str.replace(/^[\d.e+-]+/, formattedNumber);
        }
        
        // Handle plain numbers (backward compatibility)
        if (typeof value === 'number') {
            if (isNaN(value) || !isFinite(value)) {
                return value === Infinity ? '∞' : 'NaN';
            }
            return this.formatNumber(value);
        }
        
        // Handle strings
        if (typeof value === 'string') {
            return value;
        }
        
        // Handle objects (should be handled by caller, but fallback here)
        if (typeof value === 'object') {
            if (value instanceof THREE.Vector3) {
                const vec = value as THREE.Vector3;
                return `(${this.formatNumber(vec.x)}, ${this.formatNumber(vec.y)}, ${this.formatNumber(vec.z)})`;
            }
            return JSON.stringify(value);
        }
        
        // Handle booleans
        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }
        
        return String(value);
    }

    /**
     * Update all UI sections with current simulation state
     * This is the main method to call when the UI needs to be refreshed
     */
    updateAllSections(): void {
        // Update all sections that have getObject functions (dynamic sections)
        this.sections.forEach(section => {
            if (section.getObject && section.contentContainer) {
                const obj = section.getObject();
                this.updateSectionForUISection(section, obj);
            }
        });
    }

    /**
     * Helper method to get a section by ID
     */
    private getSection(id: string): UISection | undefined {
        return this.sections.find(s => s.id === id);
    }

    /**
     * Helper methods to get section-specific elements
     * IDs are normalized from class names (lowercase, spaces removed)
     */
    private getInitialParametersSection(): UISection | undefined {
        return this.getSection('orbitalbody');
    }

    private getTrajectorySection(): UISection | undefined {
        // Try to find by ID first
        let section = this.getSection('trajectory');
        if (section) return section;
        
        // If not found by ID, try to find by checking if getObject returns a Trajectory
        // This handles the case where the section was created with null object and got ID 'unknown'
        section = this.sections.find(s => {
            if (s.getObject) {
                const obj = s.getObject();
                return obj && this.getClassName(obj) === 'Trajectory';
            }
            return false;
        });
        
        // If still not found, use section index 1 (trajectory is always section 1)
        if (!section && this.sections.length > 1) {
            section = this.sections[1];
        }
        
        return section;
    }

    private getCameraSection(): UISection | undefined {
        return this.getSection('cameramanager');
    }

    private getGameLoopSection(): UISection | undefined {
        return this.getSection('gameloop');
    }


    /**
     * Update a UI section from a UISection object
     * @param section - The UI section to update
     * @param obj - The object to display (can be any object type)
     */
    private updateSectionForUISection(section: UISection, obj: any): void {
        if (!section.contentContainer) return;
        
        const emptyMessage = section.emptyMessage || 'No object available';
        
        if (!obj) {
            // If no object available, show a message
            section.contentContainer.innerHTML = '';
            const table = document.createElement('table');
            table.style.cssText = 'width: 100%; border-collapse: collapse; margin: 0; border-spacing: 0;';
            table.appendChild(this.createReadOnlyProperty(this.formatLabelFromVariableName('status'), emptyMessage));
            section.contentContainer.appendChild(table);
            return;
        }
        
        // Update section header with class name from introspection
        const className = this.getClassName(obj);
        section.headerTitle.textContent = className;
        section.title = className; // Update stored title
        
        // Update section ID if it was set to 'unknown' initially (when object was null)
        const correctId = className.toLowerCase().replace(/\s+/g, '');
        if (section.id === 'unknown' && correctId !== 'unknown') {
            section.id = correctId;
        }
        
        // Use editable property section if this is an editable section, otherwise use read-only
        if (section.isEditable) {
            this.generateEditablePropertySection(obj, section.contentContainer);
        } else {
            // Dynamically generate property section from object using introspection
            this.generatePropertySectionFromObject(obj, section.contentContainer);
        }
    }

    /**
     * Generic method to update a UI section from any object using introspection
     * This method dynamically generates the display from the object's properties
     * @param obj - The object to display (can be any object type)
     * @param container - The HTML container element to populate
     * @param header - Optional header element to update with the object's class name
     * @param emptyMessage - Optional message to show when object is null/undefined
     * @deprecated Use updateSectionForUISection instead
     */
    private updateSection(obj: any, container: HTMLDivElement, header?: HTMLSpanElement, emptyMessage: string = 'No object available'): void {
        if (!container) return;
        
        if (!obj) {
            // If no object available, show a message
            container.innerHTML = '';
            const table = document.createElement('table');
            table.style.cssText = 'width: 100%; border-collapse: collapse; margin: 0; border-spacing: 0;';
            table.appendChild(this.createReadOnlyProperty(this.formatLabelFromVariableName('status'), emptyMessage));
            container.appendChild(table);
            return;
        }
        
        // Update section header with class name from introspection
        if (header) {
            const className = this.getClassName(obj);
            header.textContent = className;
        }
        
        // Dynamically generate property section from object using introspection
        this.generatePropertySectionFromObject(obj, container);
    }


    /**
     * Update form fields to show the currently focused body's parameters
     */
    private updateFormForFocusedBody(targetName: string | null): void {
        this.currentFocusedBodyName = targetName;
        
        // Check if this is the central body (Earth) - inputs should be disabled
        const isCentralBody = targetName === config.bodies.earth.name;
        
        // Update heading
        if (this.bodyParamsHeading) {
            if (targetName === null) {
                this.bodyParamsHeading.textContent = 'Body Parameters (No Focus)';
            } else {
                this.bodyParamsHeading.textContent = `${targetName} Parameters`;
            }
        }

        // Input field enabling/disabling is now handled dynamically in generateEditablePropertySection
        // No need to manually manage input states here

        // Update all sections (including initial parameters and trajectory)
        this.updateAllSections();
    }

    /**
     * Format a number with 3 decimal places, using exponential notation if > 1e3 or < 1e-3
     */
    private formatNumber(value: number): string {
        const absValue = Math.abs(value);
        if (absValue > 1e3 || absValue < 1e-3) {
            return value.toExponential(3);
        }
        return value.toFixed(3);
    }

    /**
     * Format a distance value (in km) with appropriate unit
     */
    private formatDistance(km: number): string {
        const absKm = Math.abs(km);
        
        // Light-day: 1 Ld = 2.59e10 km
        if (absKm >= 1.295e10) {
            return `${this.formatNumber(km / 2.59e10)} Ld`;
        }
        // Light-hour: 1 Lh = 1.08e9 km
        if (absKm >= 5.4e8) {
            return `${this.formatNumber(km / 1.08e9)} Lh`;
        }
        // Light-minute: 1 Lm = 1.8e7 km
        if (absKm >= 9e6) {
            return `${this.formatNumber(km / 1.8e7)} Lm`;
        }
        // Light-second: 1 Ls = 299792.458 km (speed of light * 1 second)
        if (absKm >= 149896.229) {
            return `${this.formatNumber(km / 299792.458)} Ls`;
        }
        // Megameter: 1 Mm = 1e3 km
        if (absKm >= 500) {
            return `${this.formatNumber(km / 1e3)} Mm`;
        }
        // Kilometer: 1 km
        if (absKm >= 0.5) {
            return `${this.formatNumber(km)} Km`;
        }
        // Meter: 1 m = 1e-3 km
        if (absKm >= 0.0005) {
            return `${this.formatNumber(km * 1e3)} m`;
        }
        // Centimeter: 1 cm = 1e-5 km
        return `${this.formatNumber(km * 1e5)} cm`;
    }

    /**
     * Format a velocity value (in km/s) with appropriate unit
     */
    private formatVelocity(kmPerS: number): string {
        const absKmPerS = Math.abs(kmPerS);
        
        // For velocity, we'll use km/s, m/s, or cm/s
        // km/s
        if (absKmPerS >= 0.5) {
            return `${this.formatNumber(kmPerS)} Km/s`;
        }
        // m/s: 1 m/s = 1e-3 km/s
        if (absKmPerS >= 0.0005) {
            return `${this.formatNumber(kmPerS * 1e3)} m/s`;
        }
        // cm/s: 1 cm/s = 1e-5 km/s
        return `${this.formatNumber(kmPerS * 1e5)} cm/s`;
    }

    /**
     * Update current values display using introspection from Trajectory object
     * This is a duplicate method that should be removed - keeping for now to avoid breaking changes
     * @deprecated This method is a duplicate and should be removed
     */
    private updateCurrentValuesDisplay(): void {
        // This method is now handled by updateAllSections and updateSectionForUISection
        // Keeping stub to avoid breaking existing code
        const trajectorySection = this.getTrajectorySection();
        if (trajectorySection && trajectorySection.getObject && trajectorySection.contentContainer) {
            const obj = trajectorySection.getObject();
            this.updateSectionForUISection(trajectorySection, obj);
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

        // Update if a body is focused
        if (targetName) {
            // Update immediately
            this.updateCurrentValuesDisplay();
            
            // Update every 100ms for smooth display
            this.updateInterval = window.setInterval(() => {
                this.updateCurrentValuesDisplay();
            }, 100);
        } else {
            // Clear display for no focus
            this.updateCurrentValuesDisplay();
        }
    }

    /**
     * Start frame-by-frame updates for GameLoop section
     * This ensures currentTime and dt are updated every frame
     */
    private startGameLoopSectionUpdates(): void {
        const updateGameLoopSection = () => {
            const gameLoopSection = this.getGameLoopSection();
            if (gameLoopSection && gameLoopSection.getObject && gameLoopSection.contentContainer) {
                const obj = gameLoopSection.getObject();
                this.updateSectionForUISection(gameLoopSection, obj);
            }
            this.gameLoopUpdateFrameId = requestAnimationFrame(updateGameLoopSection);
        };
        
        // Start the update loop
        this.gameLoopUpdateFrameId = requestAnimationFrame(updateGameLoopSection);
    }
}
