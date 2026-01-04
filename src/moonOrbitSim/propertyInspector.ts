import { UIWindow, UIWindowConfig } from './uiWindow';

/**
 * PropertyInspector - A specialized UIWindow for displaying property inspector UI
 * Extends UIWindow with Unity-style Property Inspector appearance
 */
export class PropertyInspector extends UIWindow {
    constructor(config?: Partial<UIWindowConfig>) {
        super({
            title: 'Property Inspector',
            x: 10,
            y: 10,
            width: 300,
            height: 600,
            minWidth: 250,
            minHeight: 200,
            resizable: true,
            closable: true,
            maximizable: true,
            minimizable: true,
            dockable: true,
            ...config
        });

        // Additional styling specific to property inspector
        this.contentArea.style.cssText = `
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            margin: 0;
            padding: 0;
        `;
    }

    /**
     * Get the content area for adding sections
     */
    public getPropertyInspectorContent(): HTMLDivElement {
        return this.contentArea;
    }
}
