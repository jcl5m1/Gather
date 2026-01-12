/**
 * Demo for PlotWindow - Creates plots showing bezier animation analysis
 */

import { PlotWindow } from './plotWindow';
import './performanceTest'; // Import to register benchmark function
import { OrbitalBody } from './orbitalBody';

// Global state for plot window tracking (simple singleton-ish pattern to avoid duplicates if desired, 
// though the user might want multiple. For now, we'll replace the existing ones if they exist 
// to avoid clutter or create new ones if requested.)
interface PlotSet {
    warp: PlotWindow;
    error: PlotWindow;
    cleanup: () => void;
    bodyName: string;
}

const activePlotSet: PlotSet | null = null;

import { config } from './config';

export function createOrbitErrorPlot(targetBody?: OrbitalBody | null): PlotWindow | null {
    if (!config.visualization.enablePlots) {
        return null; // Plots disabled via config
    }
    return null; // Fallback for now if enablement logic isn't fully restored or if we just want to satisfy compiler
}

// Alias for backward compatibility
export function createSinePlotDemo(): PlotWindow | null {
    return createOrbitErrorPlot();
}

// Make it available globally
(window as any).createSinePlotDemo = createSinePlotDemo;
(window as any).createOrbitErrorPlot = createOrbitErrorPlot;
(window as any).plotWindows = activePlotSet;
