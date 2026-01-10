/**
 * UIWindow - A draggable, resizable, closable, maximizable, minimizable, dockable window
 * Provides Unity-style Property Inspector appearance
 */

export interface UIWindowConfig {
    title: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    resizable?: boolean;
    closable?: boolean;
    maximizable?: boolean;
    minimizable?: boolean;
    dockable?: boolean;
}

interface DockZone {
    side: 'left' | 'right' | 'top' | 'bottom';
    x: number;
    y: number;
    width: number;
    height: number;
}

export class UIWindow {
    protected container: HTMLDivElement;
    protected titleBar: HTMLDivElement;
    protected titleText: HTMLSpanElement;
    protected buttonContainer: HTMLDivElement;
    protected contentArea: HTMLDivElement;
    protected config: Required<UIWindowConfig>;
    
    private isDragging: boolean = false;
    private isResizing: boolean = false;
    private resizeDirection: string = '';
    private dragStartX: number = 0;
    private dragStartY: number = 0;
    private resizeStartX: number = 0;
    private resizeStartY: number = 0;
    private windowStartX: number = 0;
    private windowStartY: number = 0;
    private windowStartWidth: number = 0;
    private windowStartHeight: number = 0;
    private resizeHandle: HTMLDivElement | null = null;
    private edgeResizeHandles: { [key: string]: HTMLDivElement } = {};
    private isMaximized: boolean = false;
    private isMinimized: boolean = false;
    private isDocked: boolean = false;
    private dockedSide: 'left' | 'right' | 'top' | 'bottom' | null = null;
    private preMaximizeState: { x: number; y: number; width: number; height: number } | null = null;
    private preDockState: { x: number; y: number; width: number; height: number } | null = null;
    private dockIndicator: HTMLDivElement | null = null;

    constructor(config: UIWindowConfig) {
        // Set defaults
        this.config = {
            title: config.title,
            x: config.x ?? 10,
            y: config.y ?? 10,
            width: config.width ?? 300,
            height: config.height ?? 400,
            minWidth: config.minWidth ?? 200,
            minHeight: config.minHeight ?? 150,
            resizable: config.resizable ?? true,
            closable: config.closable ?? true,
            maximizable: config.maximizable ?? true,
            minimizable: config.minimizable ?? true,
            dockable: config.dockable ?? true,
        };

        // Create window container
        this.container = this.createContainer();
        this.titleBar = this.createTitleBar();
        this.titleText = this.titleBar.querySelector('.window-title') as HTMLSpanElement;
        this.buttonContainer = this.titleBar.querySelector('.window-buttons') as HTMLDivElement;
        this.contentArea = this.createContentArea();

        this.container.appendChild(this.titleBar);
        this.container.appendChild(this.contentArea);

        // Add resize handles if resizable
        if (this.config.resizable) {
            this.createResizeHandles();
        }

        // Setup event listeners
        this.setupEventListeners();

        // Add to DOM
        document.body.appendChild(this.container);
    }

    private createContainer(): HTMLDivElement {
        const container = document.createElement('div');
        container.className = 'ui-window';
        container.style.cssText = `
            position: absolute;
            left: ${this.config.x}px;
            top: ${this.config.y}px;
            width: ${this.config.width}px;
            height: ${this.config.height}px;
            min-width: ${this.config.minWidth}px;
            min-height: ${this.config.minHeight}px;
            background: rgba(30,30,30,0.95);
            color: white;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 12px;
            border: 1px solid rgba(255,255,255,0.2);
            box-shadow: 0 2px 10px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            z-index: 1000;
        `;
        return container;
    }

    private createTitleBar(): HTMLDivElement {
        const titleBar = document.createElement('div');
        titleBar.className = 'window-titlebar';
        titleBar.style.cssText = `
            padding: 1px 2px;
            background: rgba(0,0,0,0.5);
            border-bottom: 1px solid rgba(255,255,255,0.2);
            font-weight: bold;
            font-size: 11px;
            cursor: move;
            display: flex;
            justify-content: space-between;
            align-items: center;
            user-select: none;
            flex-shrink: 0;
            height: 18px;
        `;

        const titleText = document.createElement('span');
        titleText.className = 'window-title';
        titleText.textContent = this.config.title;

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'window-buttons';
        buttonContainer.style.cssText = `
            display: flex;
            gap: 2px;
        `;

        // Create window control buttons
        if (this.config.minimizable) {
            const minimizeBtn = this.createTitleBarButton('−', 'Minimize');
            minimizeBtn.onclick = (e) => {
                e.stopPropagation();
                this.minimize();
            };
            buttonContainer.appendChild(minimizeBtn);
        }

        if (this.config.maximizable) {
            const maximizeBtn = this.createTitleBarButton('□', 'Maximize');
            maximizeBtn.onclick = (e) => {
                e.stopPropagation();
                this.maximize();
            };
            buttonContainer.appendChild(maximizeBtn);
        }

        if (this.config.closable) {
            const closeBtn = this.createTitleBarButton('×', 'Close');
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                this.close();
            };
            buttonContainer.appendChild(closeBtn);
        }

        titleBar.appendChild(titleText);
        titleBar.appendChild(buttonContainer);

        return titleBar;
    }

    private createTitleBarButton(text: string, title: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.textContent = text;
        button.title = title;
        button.style.cssText = `
            width: 16px;
            height: 16px;
            padding: 0;
            background: rgba(255,255,255,0.1);
            color: white;
            border: none;
            cursor: pointer;
            font-size: 12px;
            line-height: 1;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        button.onmouseenter = () => {
            button.style.background = 'rgba(255,255,255,0.2)';
        };
        button.onmouseleave = () => {
            button.style.background = 'rgba(255,255,255,0.1)';
        };
        return button;
    }

    private createContentArea(): HTMLDivElement {
        const contentArea = document.createElement('div');
        contentArea.className = 'window-content';
        contentArea.style.cssText = `
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            margin: 0;
            padding: 0;
        `;
        return contentArea;
    }

    private createResizeHandle(): HTMLDivElement {
        const handle = document.createElement('div');
        handle.className = 'window-resize-handle';
        handle.style.cssText = `
            position: absolute;
            right: 0;
            bottom: 0;
            width: 16px;
            height: 16px;
            cursor: nwse-resize;
            background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.2) 50%);
        `;
        return handle;
    }

    private createResizeHandles(): void {
        const edgeSize = 5;
        const cornerSize = 16;
        
        // Create edge resize handles
        const edges = [
            { name: 'top', cursor: 'ns-resize', style: `top: 0; left: ${cornerSize}px; right: ${cornerSize}px; height: ${edgeSize}px;` },
            { name: 'right', cursor: 'ew-resize', style: `top: ${cornerSize}px; right: 0; bottom: ${cornerSize}px; width: ${edgeSize}px;` },
            { name: 'bottom', cursor: 'ns-resize', style: `bottom: 0; left: ${cornerSize}px; right: ${cornerSize}px; height: ${edgeSize}px;` },
            { name: 'left', cursor: 'ew-resize', style: `top: ${cornerSize}px; left: 0; bottom: ${cornerSize}px; width: ${edgeSize}px;` }
        ];
        
        for (const edge of edges) {
            const handle = document.createElement('div');
            handle.className = `resize-${edge.name}`;
            handle.style.cssText = `
                position: absolute;
                ${edge.style}
                cursor: ${edge.cursor};
                z-index: 10;
            `;
            handle.addEventListener('mousedown', (e) => this.startEdgeResize(e, edge.name));
            this.container.appendChild(handle);
            this.edgeResizeHandles[edge.name] = handle;
        }
        
        // Create corner resize handles
        const corners = [
            { name: 'top-left', cursor: 'nwse-resize', style: `top: 0; left: 0; width: ${cornerSize}px; height: ${cornerSize}px;` },
            { name: 'top-right', cursor: 'nesw-resize', style: `top: 0; right: 0; width: ${cornerSize}px; height: ${cornerSize}px;` },
            { name: 'bottom-right', cursor: 'nwse-resize', style: `bottom: 0; right: 0; width: ${cornerSize}px; height: ${cornerSize}px;` },
            { name: 'bottom-left', cursor: 'nesw-resize', style: `bottom: 0; left: 0; width: ${cornerSize}px; height: ${cornerSize}px;` }
        ];
        
        for (const corner of corners) {
            const handle = document.createElement('div');
            handle.className = `resize-${corner.name}`;
            handle.style.cssText = `
                position: absolute;
                ${corner.style}
                cursor: ${corner.cursor};
                z-index: 11;
            `;
            // Add visible indicator for bottom-right corner only
            if (corner.name === 'bottom-right') {
                handle.style.background = 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.2) 50%)';
            }
            handle.addEventListener('mousedown', (e) => this.startEdgeResize(e, corner.name));
            this.container.appendChild(handle);
            this.edgeResizeHandles[corner.name] = handle;
        }
    }

    private createDockIndicator(): HTMLDivElement {
        const indicator = document.createElement('div');
        indicator.style.cssText = `
            position: fixed;
            background: rgba(100,150,255,0.3);
            border: 2px solid rgba(100,150,255,0.6);
            pointer-events: none;
            z-index: 9999;
            display: none;
        `;
        document.body.appendChild(indicator);
        return indicator;
    }

    private setupEventListeners(): void {
        // Dragging
        this.titleBar.addEventListener('mousedown', (e) => {
            if (e.target === this.titleBar || e.target === this.titleText) {
                this.startDrag(e);
            }
        });

        // Resizing
        if (this.resizeHandle) {
            this.resizeHandle.addEventListener('mousedown', (e) => {
                this.startResize(e);
            });
        }

        // Global mouse move and up handlers
        document.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.drag(e);
            } else if (this.isResizing) {
                this.resize(e);
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.endDrag();
            } else if (this.isResizing) {
                this.endResize();
            }
        });

        // Double-click title bar to maximize
        this.titleBar.addEventListener('dblclick', () => {
            if (this.config.maximizable) {
                this.maximize();
            }
        });

        // Bring to front on click
        this.container.addEventListener('mousedown', () => {
            this.bringToFront();
        });
    }

    private startDrag(e: MouseEvent): void {
        if (this.isMaximized || this.isDocked) return;
        
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.windowStartX = this.container.offsetLeft;
        this.windowStartY = this.container.offsetTop;
        
        this.bringToFront();
        e.preventDefault();
    }

    private drag(e: MouseEvent): void {
        if (!this.isDragging) return;

        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        
        const newX = this.windowStartX + dx;
        const newY = this.windowStartY + dy;
        
        this.container.style.left = `${newX}px`;
        this.container.style.top = `${newY}px`;

        // Show dock indicator if dockable
        if (this.config.dockable) {
            this.showDockIndicator(e.clientX, e.clientY);
        }
    }

    private endDrag(): void {
        this.isDragging = false;
        
        // Check if we should dock
        if (this.config.dockable && this.dockIndicator) {
            const dockZone = this.getDockZone(event as MouseEvent);
            if (dockZone) {
                this.dockToSide(dockZone.side);
            }
            this.hideDockIndicator();
        }
    }

    private startResize(e: MouseEvent): void {
        if (this.isMaximized) return;
        
        this.isResizing = true;
        this.resizeDirection = 'bottom-right';
        this.resizeStartX = e.clientX;
        this.resizeStartY = e.clientY;
        this.windowStartX = this.container.offsetLeft;
        this.windowStartY = this.container.offsetTop;
        this.windowStartWidth = this.container.offsetWidth;
        this.windowStartHeight = this.container.offsetHeight;
        
        e.preventDefault();
        e.stopPropagation();
    }

    private startEdgeResize(e: MouseEvent, direction: string): void {
        if (this.isMaximized) return;
        
        // Allow resizing when docked, but only on certain edges
        if (this.isDocked) {
            // If docked left/right, only allow horizontal resizing on right/left edge
            if ((this.dockedSide === 'left' && direction !== 'right') ||
                (this.dockedSide === 'right' && direction !== 'left') ||
                (this.dockedSide === 'top' && direction !== 'bottom') ||
                (this.dockedSide === 'bottom' && direction !== 'top')) {
                return;
            }
        }
        
        this.isResizing = true;
        this.resizeDirection = direction;
        this.resizeStartX = e.clientX;
        this.resizeStartY = e.clientY;
        this.windowStartX = this.container.offsetLeft;
        this.windowStartY = this.container.offsetTop;
        this.windowStartWidth = this.container.offsetWidth;
        this.windowStartHeight = this.container.offsetHeight;
        
        e.preventDefault();
        e.stopPropagation();
    }

    private resize(e: MouseEvent): void {
        if (!this.isResizing) return;

        const dx = e.clientX - this.resizeStartX;
        const dy = e.clientY - this.resizeStartY;
        
        let newX = this.windowStartX;
        let newY = this.windowStartY;
        let newWidth = this.windowStartWidth;
        let newHeight = this.windowStartHeight;
        
        // Handle different resize directions
        if (this.resizeDirection.includes('right')) {
            newWidth = Math.max(this.config.minWidth, this.windowStartWidth + dx);
        }
        if (this.resizeDirection.includes('left')) {
            const targetWidth = Math.max(this.config.minWidth, this.windowStartWidth - dx);
            if (targetWidth > this.config.minWidth || dx < 0) {
                newWidth = targetWidth;
                newX = this.windowStartX + (this.windowStartWidth - newWidth);
            }
        }
        if (this.resizeDirection.includes('bottom')) {
            newHeight = Math.max(this.config.minHeight, this.windowStartHeight + dy);
        }
        if (this.resizeDirection.includes('top')) {
            const targetHeight = Math.max(this.config.minHeight, this.windowStartHeight - dy);
            if (targetHeight > this.config.minHeight || dy < 0) {
                newHeight = targetHeight;
                newY = this.windowStartY + (this.windowStartHeight - newHeight);
            }
        }
        
        // Apply changes
        if (!this.isDocked) {
            this.container.style.left = `${newX}px`;
            this.container.style.top = `${newY}px`;
        }
        this.container.style.width = `${newWidth}px`;
        this.container.style.height = `${newHeight}px`;
    }

    private endResize(): void {
        this.isResizing = false;
        this.resizeDirection = '';
    }

    private getDockZone(e: MouseEvent): DockZone | null {
        const margin = 50; // Pixels from edge to trigger docking
        const w = window.innerWidth;
        const h = window.innerHeight;
        const currentWidth = this.container.offsetWidth;
        const currentHeight = this.container.offsetHeight;
        
        if (e.clientX < margin) {
            // Left dock - preserve width
            return { side: 'left', x: 0, y: 0, width: currentWidth, height: h };
        } else if (e.clientX > w - margin) {
            // Right dock - preserve width
            return { side: 'right', x: w - currentWidth, y: 0, width: currentWidth, height: h };
        } else if (e.clientY < margin) {
            // Top dock - preserve height
            return { side: 'top', x: 0, y: 0, width: w, height: currentHeight };
        } else if (e.clientY > h - margin) {
            // Bottom dock - preserve height
            return { side: 'bottom', x: 0, y: h - currentHeight, width: w, height: currentHeight };
        }
        
        return null;
    }

    private showDockIndicator(x: number, y: number): void {
        if (!this.dockIndicator) {
            this.dockIndicator = this.createDockIndicator();
        }
        
        const dockZone = this.getDockZone({ clientX: x, clientY: y } as MouseEvent);
        
        if (dockZone) {
            this.dockIndicator.style.left = `${dockZone.x}px`;
            this.dockIndicator.style.top = `${dockZone.y}px`;
            this.dockIndicator.style.width = `${dockZone.width}px`;
            this.dockIndicator.style.height = `${dockZone.height}px`;
            this.dockIndicator.style.display = 'block';
        } else {
            this.dockIndicator.style.display = 'none';
        }
    }

    private hideDockIndicator(): void {
        if (this.dockIndicator) {
            this.dockIndicator.style.display = 'none';
        }
    }

    public dockToSide(side: 'left' | 'right' | 'top' | 'bottom'): void {
        if (this.isDocked && this.dockedSide === side) {
            // Undock if already docked to this side
            this.undock();
            return;
        }

        // Save pre-dock state
        if (!this.isDocked) {
            this.preDockState = {
                x: this.container.offsetLeft,
                y: this.container.offsetTop,
                width: this.container.offsetWidth,
                height: this.container.offsetHeight
            };
        }

        this.isDocked = true;
        this.dockedSide = side;

        const w = window.innerWidth;
        const h = window.innerHeight;
        const currentWidth = this.container.offsetWidth;
        const currentHeight = this.container.offsetHeight;

        switch (side) {
            case 'left':
                this.container.style.left = '0px';
                this.container.style.top = '0px';
                // Keep current width when docking horizontally
                this.container.style.width = `${currentWidth}px`;
                this.container.style.height = `${h}px`;
                break;
            case 'right':
                this.container.style.left = `${w - currentWidth}px`;
                this.container.style.top = '0px';
                // Keep current width when docking horizontally
                this.container.style.width = `${currentWidth}px`;
                this.container.style.height = `${h}px`;
                break;
            case 'top':
                this.container.style.left = '0px';
                this.container.style.top = '0px';
                this.container.style.width = `${w}px`;
                // Keep current height when docking vertically
                this.container.style.height = `${currentHeight}px`;
                break;
            case 'bottom':
                this.container.style.left = '0px';
                this.container.style.top = `${h - currentHeight}px`;
                this.container.style.width = `${w}px`;
                // Keep current height when docking vertically
                this.container.style.height = `${currentHeight}px`;
                break;
        }

        // Disable resize handle when docked
        if (this.resizeHandle) {
            this.resizeHandle.style.display = 'none';
        }
    }

    private undock(): void {
        if (!this.isDocked || !this.preDockState) return;

        this.isDocked = false;
        this.dockedSide = null;

        this.container.style.left = `${this.preDockState.x}px`;
        this.container.style.top = `${this.preDockState.y}px`;
        this.container.style.width = `${this.preDockState.width}px`;
        this.container.style.height = `${this.preDockState.height}px`;

        this.preDockState = null;

        // Re-enable resize handle
        if (this.resizeHandle) {
            this.resizeHandle.style.display = 'block';
        }
    }

    public maximize(): void {
        if (this.isMaximized) {
            this.restore();
            return;
        }

        // Save pre-maximize state
        this.preMaximizeState = {
            x: this.container.offsetLeft,
            y: this.container.offsetTop,
            width: this.container.offsetWidth,
            height: this.container.offsetHeight
        };

        this.isMaximized = true;
        this.isDocked = false;
        this.dockedSide = null;

        this.container.style.left = '0px';
        this.container.style.top = '0px';
        this.container.style.width = '100vw';
        this.container.style.height = '100vh';

        // Hide resize handle when maximized
        if (this.resizeHandle) {
            this.resizeHandle.style.display = 'none';
        }
    }

    public minimize(): void {
        if (this.isMinimized) {
            this.restore();
            return;
        }

        // Save current height before minimizing
        if (!this.preMaximizeState) {
            this.preMaximizeState = {
                x: this.container.offsetLeft,
                y: this.container.offsetTop,
                width: this.container.offsetWidth,
                height: this.container.offsetHeight
            };
        }

        this.isMinimized = true;
        this.contentArea.style.display = 'none';
        
        // Hide all resize handles when minimized
        if (this.resizeHandle) {
            this.resizeHandle.style.display = 'none';
        }
        Object.values(this.edgeResizeHandles).forEach(handle => {
            handle.style.display = 'none';
        });
        
        // Remove minHeight constraint and set height to just the title bar
        this.container.style.minHeight = '0';
        const titleBarHeight = this.titleBar.offsetHeight;
        this.container.style.height = `${titleBarHeight}px`;
    }

    public restore(): void {
        if (this.isMaximized && this.preMaximizeState) {
            this.isMaximized = false;
            this.container.style.left = `${this.preMaximizeState.x}px`;
            this.container.style.top = `${this.preMaximizeState.y}px`;
            this.container.style.width = `${this.preMaximizeState.width}px`;
            this.container.style.height = `${this.preMaximizeState.height}px`;
            this.preMaximizeState = null;

            // Re-enable resize handle
            if (this.resizeHandle) {
                this.resizeHandle.style.display = 'block';
            }
        }

        if (this.isMinimized && this.preMaximizeState) {
            this.isMinimized = false;
            this.contentArea.style.display = 'block';
            
            // Restore minHeight constraint
            this.container.style.minHeight = `${this.config.minHeight}px`;
            
            // Restore all resize handles
            if (this.resizeHandle) {
                this.resizeHandle.style.display = 'block';
            }
            Object.values(this.edgeResizeHandles).forEach(handle => {
                handle.style.display = 'block';
            });
            
            // Restore to saved height
            this.container.style.height = `${this.preMaximizeState.height}px`;
            this.preMaximizeState = null;
        }
    }

    public close(): void {
        this.hide();
    }

    public show(): void {
        this.container.style.display = 'flex';
    }

    public hide(): void {
        this.container.style.display = 'none';
    }

    public bringToFront(): void {
        // Find highest z-index among all windows
        const allWindows = document.querySelectorAll('.ui-window');
        let maxZ = 1000;
        allWindows.forEach((win) => {
            const z = parseInt((win as HTMLElement).style.zIndex || '1000');
            if (z > maxZ) maxZ = z;
        });
        this.container.style.zIndex = `${maxZ + 1}`;
    }

    public setTitle(title: string): void {
        this.config.title = title;
        this.titleText.textContent = title;
    }

    public getContentArea(): HTMLDivElement {
        return this.contentArea;
    }

    public getContainer(): HTMLDivElement {
        return this.container;
    }
}
