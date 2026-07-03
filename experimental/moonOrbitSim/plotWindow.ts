/**
 * PlotWindow - A UIWindow subclass for 2D XY plotting
 * Provides axis rendering, grid, and interactive hover tooltips
 */

import { UIWindow, UIWindowConfig } from './uiWindow';
import { Measure, seconds, getTimeUnit } from './units';

export interface PlotData {
    x: number[];
    y: number[];
    color?: string;
    lineWidth?: number;
    plotType?: 'line' | 'scatter';
    pointSize?: number;
    tooltips?: string[];  // Custom tooltip for each point
}

export interface HeatmapData {
    x: number[];    // Cell grid X coordinates
    y: number[];    // Cell grid Y coordinates
    z: number[][];  // 2D data values [y][x]
    zMin: number;
    zMax: number;
    tooltips?: string[][]; // Tooltip for each cell
}

export interface PlotConfig extends UIWindowConfig {
    xMin?: number;
    xMax?: number;
    yMin?: number;
    yMax?: number;
    gridColor?: string;
    axisColor?: string;
    backgroundColor?: string;
    xLabel?: string;
    yLabel?: string;
    yLogScale?: boolean;
    xTickPositions?: number[];
    xAxisUnitType?: 'time' | 'none';
    yAxisUnitType?: 'time' | 'none';
}

export class PlotWindow extends UIWindow {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private plotData: PlotData[] = [];
    private plotConfig: {
        xMin: number;
        xMax: number;
        yMin: number;
        yMax: number;
        gridColor: string;
        axisColor: string;
        backgroundColor: string;
        xLabel: string;
        yLabel: string;
        yLogScale: boolean;
        xTickPositions: number[] | null;
        xAxisUnitType: 'time' | 'none';
        yAxisUnitType: 'time' | 'none';
    };
    private heatmapDataItems: HeatmapData[] = [];
    private tooltip: HTMLDivElement;
    private padding = { top: 40, right: 40, bottom: 50, left: 60 };
    private hoveredPoint: { x: number; y: number; dataIndex: number } | null = null;
    private heatmapCanvas: HTMLCanvasElement | null = null;

    // Zoom and pan state
    private zoomLevel: number = 1.0;
    private panOffsetX: number = 0;
    private panOffsetY: number = 0;
    private isPanning: boolean = false;
    private lastPanX: number = 0;
    private lastPanY: number = 0;
    private panMode: boolean = false;

    // Original view bounds for reset
    private originalXMin: number;
    private originalXMax: number;
    private originalYMin: number;
    private originalYMax: number;

    // Control buttons
    private controlsContainer: HTMLDivElement;

    // Animation state indicator
    private currentAnimationPosition: number | null = null;
    private currentAnimationYPosition: number | null = null;
    
    // Simulation timeline indicator
    private currentTimelinePosition: number | null = null;

    constructor(config: PlotConfig) {
        super(config);

        // Set plot-specific config with defaults
        this.plotConfig = {
            xMin: config.xMin ?? 0,
            xMax: config.xMax ?? 1,
            yMin: config.yMin ?? -1,
            yMax: config.yMax ?? 1,
            gridColor: config.gridColor ?? 'rgba(255, 255, 255, 0.1)',
            axisColor: config.axisColor ?? 'rgba(255, 255, 255, 0.8)',
            backgroundColor: config.backgroundColor ?? 'rgba(20, 20, 20, 1)',
            xLabel: config.xLabel ?? 'X',
            yLabel: config.yLabel ?? 'Y',
            yLogScale: config.yLogScale ?? false,
            xTickPositions: config.xTickPositions ?? null,
            xAxisUnitType: config.xAxisUnitType ?? 'none',
            yAxisUnitType: config.yAxisUnitType ?? 'none',
        };

        // Store original bounds for reset
        this.originalXMin = this.plotConfig.xMin;
        this.originalXMax = this.plotConfig.xMax;
        this.originalYMin = this.plotConfig.yMin;
        this.originalYMax = this.plotConfig.yMax;

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = `
            width: 100%;
            height: 100%;
            display: block;
        `;

        const ctx = this.canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get 2D context');
        }
        this.ctx = ctx;

        // Create tooltip
        this.tooltip = this.createTooltip();

        // Create control buttons
        this.controlsContainer = this.createControls();

        // Add canvas and controls to content area
        this.getContentArea().appendChild(this.canvas);
        this.getContentArea().appendChild(this.controlsContainer);
        document.body.appendChild(this.tooltip);

        // Setup canvas resize observer
        this.setupResizeObserver();

        // Setup mouse events for hover
        this.setupMouseEvents();

        // Setup pan mouse events
        this.setupPanEvents();

        // Initial render
        this.updateCanvasSize();
        this.render();
    }

    private createTooltip(): HTMLDivElement {
        const tooltip = document.createElement('div');
        tooltip.style.cssText = `
            position: fixed;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            border: 1px solid rgba(255, 255, 255, 0.3);
            font-family: 'Courier New', monospace;
            font-size: 12px;
            pointer-events: none;
            z-index: 10000;
            display: none;
            white-space: nowrap;
        `;
        return tooltip;
    }

    private createControls(): HTMLDivElement {
        const container = document.createElement('div');
        container.style.cssText = `
            position: absolute;
            top: 31px;
            right: 10px;
            display: flex;
            flex-direction: column;
            gap: 5px;
            z-index: 100;
        `;

        // Only reset button
        const resetBtn = this.createButton('⊙', 'Reset View');
        resetBtn.addEventListener('click', () => this.resetView());

        container.appendChild(resetBtn);

        return container;
    }

    private createButton(text: string, title: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.textContent = text;
        button.title = title;
        button.style.cssText = `
            width: 32px;
            height: 32px;
            background: rgba(40, 40, 40, 0.9);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        `;

        button.addEventListener('mouseenter', () => {
            button.style.background = 'rgba(60, 60, 60, 0.9)';
        });

        button.addEventListener('mouseleave', () => {
            if (button.id === 'panModeBtn' && this.panMode) {
                button.style.background = 'rgba(80, 120, 200, 0.9)';
            } else {
                button.style.background = 'rgba(40, 40, 40, 0.9)';
            }
        });

        return button;
    }

    private setupPanEvents(): void {
        // Pan is now always enabled
        this.panMode = true;
        this.canvas.style.cursor = 'grab';

        this.canvas.addEventListener('mousedown', (e) => {
            this.isPanning = true;
            this.lastPanX = e.clientX;
            this.lastPanY = e.clientY;
            this.canvas.style.cursor = 'grabbing';
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                const deltaX = e.clientX - this.lastPanX;
                const deltaY = e.clientY - this.lastPanY;

                this.pan(deltaX, deltaY);

                this.lastPanX = e.clientX;
                this.lastPanY = e.clientY;
            }
        });

        this.canvas.addEventListener('mouseup', () => {
            this.isPanning = false;
            this.canvas.style.cursor = 'grab';
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.isPanning = false;
            this.canvas.style.cursor = 'grab';
        });

        // Add scroll wheel zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            // Get mouse position relative to canvas
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Convert to data coordinates before zoom
            const dataX = this.screenToDataX(mouseX);
            const dataY = this.screenToDataY(mouseY);

            if (e.deltaY < 0) {
                // Scroll up = zoom in
                this.zoomIn(dataX, dataY);
            } else {
                // Scroll down = zoom out
                this.zoomOut(dataX, dataY);
            }
        });
    }

    private zoomIn(centerX?: number, centerY?: number): void {
        this.zoomLevel *= 1.025;  // Reduced from 1.2 to 1.025
        this.applyZoom(centerX, centerY);
    }

    private zoomOut(centerX?: number, centerY?: number): void {
        this.zoomLevel /= 1.025;
        if (this.zoomLevel < 1.0) {
            this.zoomLevel = 1.0;
        }
        this.applyZoom(centerX, centerY);
    }

    private resetView(): void {
        this.zoomLevel = 1.0;
        this.panOffsetX = 0;
        this.panOffsetY = 0;

        // Restore original bounds
        this.plotConfig.xMin = this.originalXMin;
        this.plotConfig.xMax = this.originalXMax;
        this.plotConfig.yMin = this.originalYMin;
        this.plotConfig.yMax = this.originalYMax;

        this.render();
    }

    private applyZoom(centerX?: number, centerY?: number): void {
        // If no center provided, use the current view center
        if (centerX === undefined || centerY === undefined) {
            centerX = (this.plotConfig.xMin + this.plotConfig.xMax) / 2;
            centerY = (this.plotConfig.yMin + this.plotConfig.yMax) / 2;
        }

        // Calculate the original range
        const originalXRange = this.originalXMax - this.originalXMin;
        const originalYRange = this.originalYMax - this.originalYMin;

        // Calculate the new range based on zoom level
        const xRange = originalXRange / this.zoomLevel;
        const yRange = originalYRange / this.zoomLevel;

        // Calculate what fraction of the range the center point should be at
        const xFraction = (centerX - this.plotConfig.xMin) / (this.plotConfig.xMax - this.plotConfig.xMin);
        const yFraction = (centerY - this.plotConfig.yMin) / (this.plotConfig.yMax - this.plotConfig.yMin);

        // Apply the new range centered on the zoom point
        this.plotConfig.xMin = centerX - xRange * xFraction;
        this.plotConfig.xMax = centerX + xRange * (1 - xFraction);
        this.plotConfig.yMin = centerY - yRange * yFraction;
        this.plotConfig.yMax = centerY + yRange * (1 - yFraction);

        this.constrainBounds();

        // Update pan offset for reset functionality
        const originalCenterX = (this.originalXMin + this.originalXMax) / 2;
        const originalCenterY = (this.originalYMin + this.originalYMax) / 2;
        const currentCenterX = (this.plotConfig.xMin + this.plotConfig.xMax) / 2;
        const currentCenterY = (this.plotConfig.yMin + this.plotConfig.yMax) / 2;
        this.panOffsetX = currentCenterX - originalCenterX;
        this.panOffsetY = currentCenterY - originalCenterY;

        this.render();
    }

    private pan(deltaX: number, deltaY: number): void {
        const rect = this.canvas.getBoundingClientRect();
        const plotWidth = rect.width - this.padding.left - this.padding.right;
        const plotHeight = rect.height - this.padding.top - this.padding.bottom;

        // Convert pixel delta to data delta
        const dataRangeX = this.plotConfig.xMax - this.plotConfig.xMin;
        const dataRangeY = this.plotConfig.yMax - this.plotConfig.yMin;

        const dataDeltaX = -(deltaX / plotWidth) * dataRangeX;
        const dataDeltaY = (deltaY / plotHeight) * dataRangeY;

        // Update plot config
        this.plotConfig.xMin += dataDeltaX;
        this.plotConfig.xMax += dataDeltaX;
        this.plotConfig.yMin += dataDeltaY;
        this.plotConfig.yMax += dataDeltaY;

        this.constrainBounds();

        // Update pan offset for zoom reference
        this.panOffsetX += dataDeltaX;
        this.panOffsetY += dataDeltaY;

        this.render();
    }


    private constrainBounds(): void {
        const xRange = this.plotConfig.xMax - this.plotConfig.xMin;
        const yRange = this.plotConfig.yMax - this.plotConfig.yMin;

        const originalXRange = this.originalXMax - this.originalXMin;
        const originalYRange = this.originalYMax - this.originalYMin;

        // Ensure current range is not larger than original
        if (xRange > originalXRange) {
            this.plotConfig.xMin = this.originalXMin;
            this.plotConfig.xMax = this.originalXMax;
        } else {
            if (this.plotConfig.xMin < this.originalXMin) {
                this.plotConfig.xMin = this.originalXMin;
                this.plotConfig.xMax = this.originalXMin + xRange;
            } else if (this.plotConfig.xMax > this.originalXMax) {
                this.plotConfig.xMax = this.originalXMax;
                this.plotConfig.xMin = this.originalXMax - xRange;
            }
        }

        if (yRange > originalYRange) {
            this.plotConfig.yMin = this.originalYMin;
            this.plotConfig.yMax = this.originalYMax;
        } else {
            if (this.plotConfig.yMin < this.originalYMin) {
                this.plotConfig.yMin = this.originalYMin;
                this.plotConfig.yMax = this.originalYMin + yRange;
            } else if (this.plotConfig.yMax > this.originalYMax) {
                this.plotConfig.yMax = this.originalYMax;
                this.plotConfig.yMin = this.originalYMax - yRange;
            }
        }
    }

    private setupResizeObserver(): void {
        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                this.updateCanvasSize();
                this.render();
            });
        });
        resizeObserver.observe(this.getContentArea());
    }

    private updateCanvasSize(): void {
        const contentArea = this.getContentArea();
        const rect = contentArea.getBoundingClientRect();

        // Set canvas size to match container with device pixel ratio
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;

        // Scale context to account for device pixel ratio
        this.ctx.scale(dpr, dpr);

        // Set canvas display size
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
    }

    private setupMouseEvents(): void {
        this.canvas.addEventListener('mousemove', (e) => {
            this.handleMouseMove(e);
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.tooltip.style.display = 'none';
            this.hoveredPoint = null;
            this.render();
        });
    }

    private handleMouseMove(e: MouseEvent): void {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Convert mouse position to data coordinates
        const dataX = this.screenToDataX(mouseX);
        const dataY = this.screenToDataY(mouseY);

        // Prioritize scatter points (like Optimized Solution) over heatmap
        let closestX: number | null = null;
        let closestY: number | null = null;
        let closestDataIndex: number | null = null;
        let closestPointIndex: number | null = null;
        let closestDistance: number = Infinity;

        this.plotData.forEach((data, dataIndex) => {
            const isScatter = data.plotType === 'scatter';
            if (!isScatter) return;

            for (let i = 0; i < data.x.length; i++) {
                const x = data.x[i];
                const y = data.y[i];
                const screenX = this.dataToScreenX(x);
                const screenY = this.dataToScreenY(y);
                const distance = Math.sqrt(Math.pow(screenX - mouseX, 2) + Math.pow(screenY - mouseY, 2));

                if (distance < 15 && distance < closestDistance) {
                    closestX = x;
                    closestY = y;
                    closestDataIndex = dataIndex;
                    closestPointIndex = i;
                    closestDistance = distance;
                }
            }
        });

        if (closestX !== null && closestY !== null && closestDataIndex !== null && closestPointIndex !== null) {
            const xVal = closestX as number;
            const yVal = closestY as number;
            this.hoveredPoint = { x: xVal, y: yVal, dataIndex: closestDataIndex };
            const data = this.plotData[closestDataIndex];
            this.tooltip.innerHTML = (data.tooltips && data.tooltips[closestPointIndex]) || `x: ${xVal.toFixed(2)}, y: ${yVal.toFixed(2)}`;
            this.tooltip.style.left = `${e.clientX + 15}px`;
            this.tooltip.style.top = `${e.clientY + 15}px`;
            this.tooltip.style.display = 'block';
            this.render();
            return;
        }

        // Check Heatmaps if no points nearby
        for (let h = this.heatmapDataItems.length - 1; h >= 0; h--) {
            const heatmap = this.heatmapDataItems[h];
            const { x, y, z, tooltips } = heatmap;
            // Find cell index
            let bestI = -1;
            let bestJ = -1;
            let minDistX = Infinity;
            let minDistY = Infinity;

            for (let i = 0; i < x.length; i++) {
                const dist = Math.abs(x[i] - dataX);
                if (dist < minDistX) {
                    minDistX = dist;
                    bestI = i;
                }
            }
            for (let j = 0; j < y.length; j++) {
                const dist = Math.abs(y[j] - dataY);
                if (dist < minDistY) {
                    minDistY = dist;
                    bestJ = j;
                }
            }

            // Check if within heatmap bounds
            const dx = (x[1] - x[0]) || 1;
            const dy = (y[1] - y[0]) || 1;

            if (bestI !== -1 && bestJ !== -1 && minDistX < dx * 0.5 && minDistY < dy * 0.5) {
                this.hoveredPoint = null;
                const tooltipText = (tooltips && tooltips[bestJ][bestI]) || `z: ${z[bestJ][bestI].toFixed(4)}`;
                this.tooltip.innerHTML = tooltipText;
                this.tooltip.style.left = `${e.clientX + 15}px`;
                this.tooltip.style.top = `${e.clientY + 15}px`;
                this.tooltip.style.display = 'block';
                return;
            }
        }

        this.hoveredPoint = null;
        this.tooltip.style.display = 'none';
        this.render();
    }


    private dataToScreenX(x: number): number {
        const rect = this.canvas.getBoundingClientRect();
        const plotWidth = rect.width - this.padding.left - this.padding.right;
        return this.padding.left + ((x - this.plotConfig.xMin) / (this.plotConfig.xMax - this.plotConfig.xMin)) * plotWidth;
    }

    private screenToDataX(screenX: number): number {
        const rect = this.canvas.getBoundingClientRect();
        const plotWidth = rect.width - this.padding.left - this.padding.right;
        return this.plotConfig.xMin + ((screenX - this.padding.left) / plotWidth) * (this.plotConfig.xMax - this.plotConfig.xMin);
    }

    private dataToScreenY(y: number): number {
        const rect = this.canvas.getBoundingClientRect();
        const plotHeight = rect.height - this.padding.top - this.padding.bottom;

        if (this.plotConfig.yLogScale) {
            // Log scale: map log(y) linearly to screen space
            const logMin = Math.log10(Math.max(this.plotConfig.yMin, 1e-10));
            const logMax = Math.log10(Math.max(this.plotConfig.yMax, 1e-10));
            const logY = Math.log10(Math.max(y, 1e-10));
            return rect.height - this.padding.bottom - ((logY - logMin) / (logMax - logMin)) * plotHeight;
        } else {
            // Linear scale
            return rect.height - this.padding.bottom - ((y - this.plotConfig.yMin) / (this.plotConfig.yMax - this.plotConfig.yMin)) * plotHeight;
        }
    }

    private screenToDataY(screenY: number): number {
        const rect = this.canvas.getBoundingClientRect();
        const plotHeight = rect.height - this.padding.top - this.padding.bottom;

        if (this.plotConfig.yLogScale) {
            // Log scale: inverse of dataToScreenY
            const logMin = Math.log10(Math.max(this.plotConfig.yMin, 1e-10));
            const logMax = Math.log10(Math.max(this.plotConfig.yMax, 1e-10));
            const logY = logMin + ((rect.height - this.padding.bottom - screenY) / plotHeight) * (logMax - logMin);
            return Math.pow(10, logY);
        } else {
            // Linear scale
            return this.plotConfig.yMin + ((rect.height - this.padding.bottom - screenY) / plotHeight) * (this.plotConfig.yMax - this.plotConfig.yMin);
        }
    }

    private render(): void {
        if (!this.isOpen()) return;
        const rect = this.canvas.getBoundingClientRect();

        // Clear canvas
        this.ctx.fillStyle = this.plotConfig.backgroundColor;
        this.ctx.fillRect(0, 0, rect.width, rect.height);

        // Draw Heatmaps FIRST (Background layer)
        this.heatmapDataItems.forEach(heatmap => {
            this.drawHeatmap(heatmap);
        });

        // Draw grid
        this.drawGrid(rect.width, rect.height);

        // Draw axes
        this.drawAxes(rect.width, rect.height);

        // Draw data
        this.plotData.forEach((data, index) => {
            this.drawCurve(data, index);
        });

        // Draw animation state indicator
        if (this.currentAnimationPosition !== null) {
            this.drawAnimationIndicator(this.currentAnimationPosition, rect.width, rect.height);
        }

        if (this.currentAnimationYPosition !== null) {
            this.drawAnimationYIndicator(this.currentAnimationYPosition, rect.width, rect.height);
        }

        // Draw simulation timeline indicator
        if (this.currentTimelinePosition !== null) {
            this.drawTimelineIndicator(this.currentTimelinePosition, rect.width, rect.height);
        }

        if (this.hoveredPoint) {
            this.drawHoverPoint(this.hoveredPoint);
        }
    }

    private drawGrid(width: number, height: number): void {
        this.ctx.strokeStyle = this.plotConfig.gridColor;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([2, 4]);

        const plotWidth = width - this.padding.left - this.padding.right;
        const plotHeight = height - this.padding.top - this.padding.bottom;

        // Vertical grid lines - use custom positions if provided
        if (this.plotConfig.xTickPositions && this.plotConfig.xTickPositions.length > 0) {
            for (const dataX of this.plotConfig.xTickPositions) {
                const x = this.dataToScreenX(dataX);
                this.ctx.beginPath();
                this.ctx.moveTo(x, this.padding.top);
                this.ctx.lineTo(x, height - this.padding.bottom);
                this.ctx.stroke();
            }
        } else {
            // Default: 8 divisions
            const xDivisions = 8;
            for (let i = 0; i <= xDivisions; i++) {
                const x = this.padding.left + (i / xDivisions) * plotWidth;
                this.ctx.beginPath();
                this.ctx.moveTo(x, this.padding.top);
                this.ctx.lineTo(x, height - this.padding.bottom);
                this.ctx.stroke();
            }
        }

        // Horizontal grid lines (8 divisions)
        const yDivisions = 8;
        for (let i = 0; i <= yDivisions; i++) {
            const y = this.padding.top + (i / yDivisions) * plotHeight;
            this.ctx.beginPath();
            this.ctx.moveTo(this.padding.left, y);
            this.ctx.lineTo(width - this.padding.right, y);
            this.ctx.stroke();
        }

        this.ctx.setLineDash([]);
    }

    private drawAxes(width: number, height: number): void {
        this.ctx.strokeStyle = this.plotConfig.axisColor;
        this.ctx.lineWidth = 2;
        this.ctx.fillStyle = this.plotConfig.axisColor;
        this.ctx.font = '12px Arial';

        // X-axis
        const xAxisY = this.dataToScreenY(0);
        this.ctx.beginPath();
        this.ctx.moveTo(this.padding.left, xAxisY);
        this.ctx.lineTo(width - this.padding.right, xAxisY);
        this.ctx.stroke();

        // Y-axis
        const yAxisX = this.dataToScreenX(0);
        this.ctx.beginPath();
        this.ctx.moveTo(yAxisX, this.padding.top);
        this.ctx.lineTo(yAxisX, height - this.padding.bottom);
        this.ctx.stroke();

        // X-axis labels
        const xDivisions = 8;
        const plotWidth = width - this.padding.left - this.padding.right;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';

        let xUnitFactor = 1;
        let xUnitLabel = '';
        if (this.plotConfig.xAxisUnitType === 'time') {
            const midX = (this.plotConfig.xMin + this.plotConfig.xMax) / 2;
            const unit = getTimeUnit(Measure.of(midX, seconds));
            xUnitFactor = unit.factor;
            xUnitLabel = ` (${unit.label})`;
        }

        for (let i = 0; i <= xDivisions; i++) {
            const x = this.padding.left + (i / xDivisions) * plotWidth;
            const dataX = this.plotConfig.xMin + (i / xDivisions) * (this.plotConfig.xMax - this.plotConfig.xMin);
            const displayX = dataX / xUnitFactor;
            this.ctx.fillText(displayX.toFixed(2), x, height - this.padding.bottom + 5);
        }

        // Y-axis labels
        const yDivisions = 8;
        const plotHeight = height - this.padding.top - this.padding.bottom;
        this.ctx.textAlign = 'right';
        this.ctx.textBaseline = 'middle';

        let yUnitFactor = 1;
        let yUnitLabel = '';
        if (this.plotConfig.yAxisUnitType === 'time') {
            const midY = (this.plotConfig.yMin + this.plotConfig.yMax) / 2;
            const unit = getTimeUnit(Measure.of(midY, seconds));
            yUnitFactor = unit.factor;
            yUnitLabel = ` (${unit.label})`;
        }

        for (let i = 0; i <= yDivisions; i++) {
            const y = height - this.padding.bottom - (i / yDivisions) * plotHeight;
            let dataY: number;
            let labelText: string;

            if (this.plotConfig.yLogScale) {
                const logMin = Math.log10(Math.max(this.plotConfig.yMin, 1e-10));
                const logMax = Math.log10(Math.max(this.plotConfig.yMax, 1e-10));
                const logY = logMin + (i / yDivisions) * (logMax - logMin);
                dataY = Math.pow(10, logY);

                if (dataY < 0.01 || dataY > 1000) {
                    labelText = dataY.toExponential(1);
                } else {
                    labelText = dataY.toFixed(2);
                }
            } else {
                dataY = this.plotConfig.yMin + (i / yDivisions) * (this.plotConfig.yMax - this.plotConfig.yMin);
                const displayY = dataY / yUnitFactor;
                labelText = displayY.toFixed(2);
            }

            this.ctx.fillText(labelText, this.padding.left - 10, y);
        }

        // Axis titles
        this.ctx.font = 'bold 14px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';
        const displayXLabel = this.plotConfig.xAxisUnitType === 'time' ? 
            this.plotConfig.xLabel + xUnitLabel : this.plotConfig.xLabel;
        this.ctx.fillText(displayXLabel, width / 2, height - 20);

        this.ctx.save();
        this.ctx.translate(15, height / 2);
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';
        const displayYLabel = this.plotConfig.yAxisUnitType === 'time' ?
            this.plotConfig.yLabel + yUnitLabel : this.plotConfig.yLabel;
        this.ctx.fillText(displayYLabel, 0, 0);
        this.ctx.restore();
    }

    private drawCurve(data: PlotData, dataIndex: number): void {
        if (data.x.length === 0) return;

        const plotType = data.plotType || 'line';
        const color = data.color || `hsl(${dataIndex * 60}, 70%, 60%)`;

        if (plotType === 'scatter') {
            // Draw scatter plot
            this.ctx.fillStyle = color;
            const pointSize = data.pointSize || 4;

            for (let i = 0; i < data.x.length; i++) {
                const x = this.dataToScreenX(data.x[i]);
                const y = this.dataToScreenY(data.y[i]);

                this.ctx.beginPath();
                this.ctx.arc(x, y, pointSize, 0, Math.PI * 2);
                this.ctx.fill();
            }
        } else {
            // Draw line plot
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = data.lineWidth || 2;
            this.ctx.setLineDash([]);

            this.ctx.beginPath();
            for (let i = 0; i < data.x.length; i++) {
                const x = this.dataToScreenX(data.x[i]);
                const y = this.dataToScreenY(data.y[i]);

                if (i === 0) {
                    this.ctx.moveTo(x, y);
                } else {
                    this.ctx.lineTo(x, y);
                }
            }
            this.ctx.stroke();
        }
    }



    private drawHoverPoint(point: { x: number; y: number; dataIndex: number }): void {
        const screenX = this.dataToScreenX(point.x);
        const screenY = this.dataToScreenY(point.y);

        const data = this.plotData[point.dataIndex];
        if (!data) return;

        const color = data.color || `hsl(${point.dataIndex * 60}, 70%, 60%)`;

        // Draw highlight circle
        this.ctx.fillStyle = color;
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(screenX, screenY, 6, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();

        // Draw crosshair
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([5, 5]);

        // Vertical line
        this.ctx.beginPath();
        this.ctx.moveTo(screenX, this.padding.top);
        this.ctx.lineTo(screenX, this.canvas.height / window.devicePixelRatio - this.padding.bottom);
        this.ctx.stroke();

        // Horizontal line
        this.ctx.beginPath();
        this.ctx.moveTo(this.padding.left, screenY);
        this.ctx.lineTo(this.canvas.width / window.devicePixelRatio - this.padding.right, screenY);
        this.ctx.stroke();

        this.ctx.setLineDash([]);
    }

    public addData(data: PlotData): void {
        this.plotData.push(data);
        this.render();
    }

    public clearData(): void {
        this.plotData = [];
        this.heatmapDataItems = [];
        this.render();
    }

    public setHeatmap(data: HeatmapData): void {
        this.heatmapDataItems = [data];
        this.render();
    }

    private createHeatmapCache(heatmap: HeatmapData): void {
        const { x, y, z, zMin, zMax } = heatmap;
        const numX = x.length;
        const numY = y.length;

        if (!this.heatmapCanvas) {
            this.heatmapCanvas = document.createElement('canvas');
        }
        
        this.heatmapCanvas.width = numX;
        this.heatmapCanvas.height = numY;
        const hCtx = this.heatmapCanvas.getContext('2d');
        if (!hCtx) return;

        hCtx.clearRect(0, 0, numX, numY);
        const imageData = hCtx.createImageData(numX, numY);
        const data = imageData.data;

        for (let j = 0; j < numY; j++) {
            for (let i = 0; i < numX; i++) {
                const val = z[j][i];
                const normalized = zMax === zMin ? 0 : (val - zMin) / (zMax - zMin);
                
                // Simplified HSLA -> RGBA for fast pixel manipulation
                // Using hue-only scale like the previous implementation
                const hue = (1 - normalized) * 240; // 240 (blue) to 0 (red)
                const rgb = this.hslToRgb(hue / 360, 0.7, 0.5);
                
                // ImageData is [y][x] with row-major order
                const idx = (j * numX + i) * 4;
                data[idx] = rgb[0];
                data[idx + 1] = rgb[1];
                data[idx + 2] = rgb[2];
                data[idx + 3] = 153; // 0.6 alpha * 255
            }
        }
        hCtx.putImageData(imageData, 0, 0);
    }

    private hslToRgb(h: number, s: number, l: number): [number, number, number] {
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    public addHeatmap(data: HeatmapData): void {
        this.heatmapDataItems.push(data);
        // We only cache the primary heatmap for simplicity in this optimization
        this.render();
    }

    private drawHeatmap(heatmap: HeatmapData): void {
        const { x, y, z, zMin, zMax } = heatmap;
        const numX = x.length;
        const numY = y.length;

        const dx = (x[1] - x[0]) || 1;
        const dy = (y[1] - y[0]) || 1;

        for (let j = 0; j < numY; j++) {
            for (let i = 0; i < numX; i++) {
                const val = z[j][i];
                if (val === -3) continue; // Skip invalid points

                const normalized = zMax === zMin ? 0 : (val - zMin) / (zMax - zMin);
                const hue = (1 - normalized) * 240;
                const rgb = this.hslToRgb(hue / 360, 0.7, 0.5);
                
                this.ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.6)`;
                
                // Calculate cell bounds in data space
                const x0 = x[i] - dx / 2;
                const x1 = x[i] + dx / 2;
                const y0 = y[j] - dy / 2;
                const y1 = y[j] + dy / 2;

                // Screen coordinates
                const sX0 = this.dataToScreenX(x0);
                const sX1 = this.dataToScreenX(x1);
                const sY0 = this.dataToScreenY(y0);
                const sY1 = this.dataToScreenY(y1);

                const rectX = Math.min(sX0, sX1);
                const rectY = Math.min(sY0, sY1);
                const rectW = Math.abs(sX1 - sX0);
                const rectH = Math.abs(sY1 - sY0);

                this.ctx.fillRect(rectX, rectY, rectW, rectH);
            }
        }
    }

    private drawHoveredHeatmapCell(): void {
        // Handled by handleMouseMove updating tooltip
    }

    public setXRange(min: number, max: number): void {
        this.originalXMin = min;
        this.originalXMax = max;
        this.resetView();
    }

    public setYRange(min: number, max: number): void {
        this.originalYMin = min;
        this.originalYMax = max;
        this.resetView();
    }

    public setAxisLabels(xLabel: string, yLabel: string): void {
        this.plotConfig.xLabel = xLabel;
        this.plotConfig.yLabel = yLabel;
        this.render();
    }

    public setXTickPositions(positions: number[] | null): void {
        this.plotConfig.xTickPositions = positions;
        this.render();
    }

    public setAnimationPosition(position: number | null): void {
        this.currentAnimationPosition = position;
        this.render();
    }

    public setAnimationYPosition(position: number | null): void {
        this.currentAnimationYPosition = position;
        this.render();
    }

    public setTimelinePosition(position: number | null): void {
        this.currentTimelinePosition = position;
        this.render();
    }

    private drawAnimationIndicator(position: number, width: number, height: number): void {
        // Draw a vertical line at the current animation position
        const x = this.dataToScreenX(position);

        // Check if the position is within the visible range
        if (x < this.padding.left || x > width - this.padding.right) {
            return;
        }

        // Get the actual Y coordinates for the plot area
        const yTop = this.padding.top;
        const yBottom = height - this.padding.bottom;

        this.ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)';  // Orange/yellow color
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([]);

        this.ctx.beginPath();
        this.ctx.moveTo(x, yTop);
        this.ctx.lineTo(x, yBottom);
        this.ctx.stroke();

        // Draw a small circle at the top
        this.ctx.fillStyle = 'rgba(255, 200, 0, 0.9)';
        this.ctx.beginPath();
        this.ctx.arc(x, yTop + 10, 4, 0, Math.PI * 2);
        this.ctx.fill();
    }

    private drawAnimationYIndicator(position: number, width: number, height: number): void {
        // Draw a horizontal line at the current animation Y position
        const y = this.dataToScreenY(position);

        // Check if the position is within the visible range
        if (y < this.padding.top || y > height - this.padding.bottom) {
            return;
        }

        const xLeft = this.padding.left;
        const xRight = width - this.padding.right;

        this.ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)';  // Orange/yellow color
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([]);

        this.ctx.beginPath();
        this.ctx.moveTo(xLeft, y);
        this.ctx.lineTo(xRight, y);
        this.ctx.stroke();

        // Draw a small circle at the left
        this.ctx.fillStyle = 'rgba(255, 200, 0, 0.9)';
        this.ctx.beginPath();
        this.ctx.arc(xLeft + 10, y, 4, 0, Math.PI * 2);
        this.ctx.fill();
    }

    private drawTimelineIndicator(position: number, width: number, height: number): void {
        // Draw a vertical line at the current simulation time position
        const x = this.dataToScreenX(position);

        // Check if the position is within the visible range
        if (x < this.padding.left || x > width - this.padding.right) {
            return;
        }

        const yTop = this.padding.top;
        const yBottom = height - this.padding.bottom;

        this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)';  // Cyan color for timeline
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([5, 5]); // Dashed line for timeline

        this.ctx.beginPath();
        this.ctx.moveTo(x, yTop);
        this.ctx.lineTo(x, yBottom);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }

    public override close(): void {
        // Clean up tooltip
        if (this.tooltip.parentNode) {
            this.tooltip.parentNode.removeChild(this.tooltip);
        }
        // Dispose of heatmap cache
        if (this.heatmapCanvas) {
            this.heatmapCanvas.width = 0;
            this.heatmapCanvas.height = 0;
            this.heatmapCanvas = null;
        }
        super.close();
    }
}
