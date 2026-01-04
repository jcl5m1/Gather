import configData from './config.json';
import { Measure, Length, Mass, Time, kilometers, kilograms, seconds, parseUnit, gravitationalConstantUnit, GenericMeasure } from './units';
import * as THREE from 'three';
import { Body } from './types';

// Helper to parse a value with unit from JSON
function parseValueWithUnit(obj: any): number {
    if (typeof obj === 'number') {
        // Backward compatibility: if it's just a number, return it
        return obj;
    }
    if (obj && typeof obj === 'object' && 'value' in obj) {
        return obj.value;
    }
    return 0;
}

// Helper to get unit string from JSON
function getUnitString(obj: any, defaultUnit: string = 'dimensionless'): string {
    if (typeof obj === 'number') {
        return defaultUnit;
    }
    if (obj && typeof obj === 'object' && 'unit' in obj) {
        return obj.unit;
    }
    return defaultUnit;
}

// Helper to parse a length value
function parseLength(obj: any): Length {
    const value = parseValueWithUnit(obj);
    const unitStr = getUnitString(obj, 'km');
    const unit = parseUnit(unitStr) || kilometers;
    return Measure.of(value, unit);
}

// Helper to parse a mass value
function parseMass(obj: any): Mass {
    const value = parseValueWithUnit(obj);
    const unitStr = getUnitString(obj, 'kg');
    const unit = parseUnit(unitStr) || kilograms;
    return Measure.of(value, unit);
}

// Helper to parse a time value
function parseTime(obj: any): Time {
    const value = parseValueWithUnit(obj);
    const unitStr = getUnitString(obj, 's');
    const unit = parseUnit(unitStr) || seconds;
    return Measure.of(value, unit);
}

// Helper to parse a vector3 position
function parseVector3(obj: any): THREE.Vector3 {
    if (Array.isArray(obj)) {
        // Backward compatibility: array format [x, y, z]
        return new THREE.Vector3(obj[0] || 0, obj[1] || 0, obj[2] || 0);
    }
    if (obj && typeof obj === 'object') {
        const x = parseValueWithUnit(obj.x || 0);
        const y = parseValueWithUnit(obj.y || 0);
        const z = parseValueWithUnit(obj.z || 0);
        return new THREE.Vector3(x, y, z);
    }
    return new THREE.Vector3(0, 0, 0);
}

// Helper to parse gravitational constant
function parseGravitationalConstant(obj: any): GenericMeasure<number, any, any> {
    const value = parseValueWithUnit(obj);
    return Measure.of(value, gravitationalConstantUnit);
}

export interface PhysicsConfig {
    gravitationalConstant: GenericMeasure<number, any, any>; // G in km³/(kg·s²)
    defaultTimeScale: number; // Dimensionless
}

export interface BodiesConfig {
    earth: Body;
    moon: Body;
}

export interface CameraConfig {
    fov: number; // Dimensionless (degrees)
    near: Length;
    far: Length;
    position: THREE.Vector3;
}

export interface GridConfig {
    size: Length;
    divisions: number; // Dimensionless
    color: string;
}

export interface AxesConfig {
    size: Length;
}

export interface LightConfig {
    ambient: {
        color: string;
    };
    directional: {
        color: string;
        intensity: number; // Dimensionless
        position: THREE.Vector3; // Dimensionless (relative)
    };
}

export interface ControlsConfig {
    enableDamping: boolean;
    dampingFactor: number; // Dimensionless
}

export interface FogConfig {
    color: string;
    near: Length;
    far: Length;
}

export interface SceneConfig {
    camera: CameraConfig;
    grid: GridConfig;
    axes: AxesConfig;
    lights: LightConfig;
    controls: ControlsConfig;
    fog?: FogConfig;
}

export interface TrailConfig {
    color: string;
    opacity: number; // Dimensionless
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

// Helper to create a Body from config data
function createBodyFromConfig(bodyData: any, distance?: Length): Body {
    const body = new Body({
        name: bodyData.name,
        mass: parseMass(bodyData.mass).over(kilograms).value,
        radius: parseLength(bodyData.radius).over(kilometers).value,
        color: bodyData.color,
        trajectoryColor: bodyData.trajectoryColor,
        position: new THREE.Vector3(0, 0, 0),
        velocity: new THREE.Vector3(0, 0, 0)
    });

    // Store distance in body.data if provided
    if (distance) {
        body.data.distance = distance.over(kilometers).value;
    }

    return body;
}

// Parse the config data and convert to typed values
function parseConfig(data: any): SimulationConfig {
    return {
        physics: {
            gravitationalConstant: parseGravitationalConstant(data.physics.gravitationalConstant),
            defaultTimeScale: parseValueWithUnit(data.physics.defaultTimeScale)
        },
        bodies: {
            earth: createBodyFromConfig(data.bodies.earth),
            moon: createBodyFromConfig(
                data.bodies.moon,
                data.bodies.moon.distance ? parseLength(data.bodies.moon.distance) : undefined
            )
        },
        scene: {
            camera: {
                fov: parseValueWithUnit(data.scene.camera.fov),
                near: parseLength(data.scene.camera.near),
                far: parseLength(data.scene.camera.far),
                position: parseVector3(data.scene.camera.position)
            },
            grid: {
                size: parseLength(data.scene.grid.size),
                divisions: parseValueWithUnit(data.scene.grid.divisions),
                color: data.scene.grid.color
            },
            axes: {
                size: parseLength(data.scene.axes.size)
            },
            lights: {
                ambient: {
                    color: data.scene.lights.ambient.color
                },
                directional: {
                    color: data.scene.lights.directional.color,
                    intensity: parseValueWithUnit(data.scene.lights.directional.intensity),
                    position: parseVector3(data.scene.lights.directional.position)
                }
            },
            controls: {
                enableDamping: data.scene.controls.enableDamping,
                dampingFactor: parseValueWithUnit(data.scene.controls.dampingFactor)
            },
            fog: data.scene.fog ? {
                color: data.scene.fog.color,
                near: parseLength(data.scene.fog.near),
                far: parseLength(data.scene.fog.far)
            } : undefined
        },
        trail: {
            color: data.trail.color,
            opacity: parseValueWithUnit(data.trail.opacity)
        }
    };
}

// Export the config with type safety
export const config: SimulationConfig = parseConfig(configData);

// Export commonly used values for convenience (extract numeric values)
export const G = config.physics.gravitationalConstant;
export const DEFAULT_TIME_SCALE = config.physics.defaultTimeScale;
