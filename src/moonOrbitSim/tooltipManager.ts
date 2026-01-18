import { OrbitalBody } from './orbitalBody';
import * as THREE from 'three';
import { UIWindow } from './uiWindow';

/**
 * Manages the tooltip UI for 3D bodies
 * Extends UIWindow for consistent styling
 */
export class TooltipManager extends UIWindow {
    private renderer: THREE.WebGLRenderer;
    private camera: THREE.Camera;
    
    // We don't need these anymore as UIWindow provides them
    // private container: HTMLDivElement;
    // private tooltip: HTMLDivElement;
    // private nameElement: HTMLDivElement;
    // private controlsElement: HTMLDivElement;
    
    private currentBody: OrbitalBody | null = null;
    private isVisible: boolean = false;
    
    // Callbacks
    public onSelect: (body: OrbitalBody) => void = () => {};
    public onTarget: (body: OrbitalBody) => void = () => {};

    constructor(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
        // Initialize as a UIWindow
        super({
            title: 'Tooltip',
            x: 0,
            y: 0,
            width: 0, // Auto width
            height: 0, // Will be auto-adjusted or irrelevant due to min-height
            minWidth: 0, // Allow compact
            minHeight: 0,
            resizable: false,
            closable: false,
            maximizable: false,
            minimizable: false,
            dockable: false
        });

        this.renderer = renderer;
        this.camera = camera;
        
        // Ensure container is hidden by default and ignore pointer events mostly?
        // Actually we need pointer events for buttons.
        // But UIWindow container captures events. 
        // We want clicks *outside* to pass through? 
        // UIWindow blocks interaction by default. 
        // We might need to adjust container style to not block entire screen (UIWindow is absolute div).
        // UIWindow default is absolute pos with specific w/h. That's fine.
        
        this.container.style.display = 'none'; // Start hidden
        this.container.style.width = 'auto'; // Override fixed width from UIWindow
        this.container.style.height = 'auto'; // Override fixed height from UIWindow
        
        // Remove default box shadow or adjust z-index if needed
        this.container.style.zIndex = '2000'; // Higher than other windows
        
        // Setup Content Area
        this.setupContent();
    }
    
    private setupContent(): void {
        const content = this.getContentArea();
        content.style.padding = '4px 0';
        content.style.display = 'flex';
        content.style.flexDirection = 'column';
        content.style.gap = '2px';
        
        // Select Button
        const selectBtn = this.createActionButton('Select');
        selectBtn.onclick = (e) => {
            e.stopPropagation();
            if (this.currentBody) this.onSelect(this.currentBody);
        };
        content.appendChild(selectBtn);
        
        // Target Button
        const targetBtn = this.createActionButton('Target');
        targetBtn.onclick = (e) => {
            e.stopPropagation();
            if (this.currentBody) this.onTarget(this.currentBody);
        };
        content.appendChild(targetBtn);
    }
    
    private createActionButton(text: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.style.cssText = `
            border: none;
            background: transparent;
            color: white;
            padding: 4px 12px;
            cursor: pointer;
            font-size: 11px;
            font-family: inherit;
            text-align: left;
            width: 100%;
            transition: background 0.1s;
            white-space: nowrap;
        `;
        btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.1)';
        btn.onmouseleave = () => btn.style.background = 'transparent';
        return btn;
    }

    /**
     * Show tooltip for a body
     */
    showTooltip(body: OrbitalBody): void {
        this.currentBody = body;
        // Update Title via UIWindow method
        this.setTitle(body.getName());
        
        this.show(); // Call UIWindow.show()
        this.isVisible = true;
        this.updatePosition();
    }
    
    /**
     * Hide tooltip
     */
    hide(): void {
        this.currentBody = null;
        this.container.style.display = 'none';
        this.isVisible = false;
    }

    /**
     * Check if tooltip is currently visible
     */
    isActive(): boolean {
        return this.isVisible;
    }
    
    /**
     * Check if mouse is over the tooltip container
     */
    isMouseOver(): boolean {
        return this.container.matches(':hover') || this.container.querySelector(':hover') !== null;
    }

    /**
     * Update tooltip position based on current body position
     */
    updatePosition(): void {
        if (!this.isVisible || !this.currentBody) return;
        
        // Get body position in world space
        const worldPos = this.currentBody.getPosition();
        
        // Project to screen space
        const v = worldPos.clone();
        v.project(this.camera);
        
        const x = (v.x * .5 + .5) * this.renderer.domElement.clientWidth;
        const y = (-(v.y * .5) + .5) * this.renderer.domElement.clientHeight;
        
        // Position tooltip to the RIGHT of the object with a margin
        const height = this.container.offsetHeight;
        const margin = 12; // Reduced from 50 to 12 (4x closer)
        
        this.container.style.left = `${x + margin}px`;
        this.container.style.top = `${y - height / 2}px`; // Vertically centered
    }
}
