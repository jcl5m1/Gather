import configData from './config.json';

export interface PhysicsConfig {
    gravitationalConstant: number;
    defaultTimeScale: number;
}

export interface BodyConfig {
    name: string;
    mass: number;
    radius: number;
    color?: string;
    trajectoryColor?: string;
    distance?: number;
}

export interface BodiesConfig {
    earth: BodyConfig;
    moon: BodyConfig;
}

export interface CameraConfig {
    fov: number;
    near: number;
    far: number;
    position: number[] | [number, number, number];
}

export interface GridConfig {
    size: number;
    divisions: number;
    color: string;
}

export interface AxesConfig {
    size: number;
}

export interface LightConfig {
    ambient: {
        color: string;
    };
    directional: {
        color: string;
        intensity: number;
        position: number[] | [number, number, number];
    };
}

export interface ControlsConfig {
    enableDamping: boolean;
    dampingFactor: number;
}

export interface SceneConfig {
    camera: CameraConfig;
    grid: GridConfig;
    axes: AxesConfig;
    lights: LightConfig;
    controls: ControlsConfig;
}

export interface TrailConfig {
    color: string;
    opacity: number;
}

export interface SimulationConfig {
    physics: PhysicsConfig;
    bodies: BodiesConfig;
    scene: SceneConfig;
    trail: TrailConfig;
}

// Helper function to convert hex color string to number
export function hexToNumber(hex: string): number {
    return parseInt(hex, 16);
}

// Export the config with type safety
export const config: SimulationConfig = configData as SimulationConfig;

// Export commonly used values for convenience
export const G = config.physics.gravitationalConstant;
export const DEFAULT_TIME_SCALE = config.physics.defaultTimeScale;

