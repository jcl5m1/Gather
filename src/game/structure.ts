import { Mesh, Vector3 } from 'three';
import { Resource } from './resource';

// Describes how a structure treats a resource in its inventory:
//   'input'  — accepts deliveries (trucks drop off), does not provide for pickup
//   'output' — provides for pickup (trucks load here), does not accept delivery
//   'both'   — can both receive and provide (e.g. Homebase staging area)
export type InventoryRole = 'input' | 'output' | 'both';

// Abstract base for all placed objects on the globe surface.
export abstract class Structure {
    abstract readonly label:           string;
    abstract readonly mesh:            Mesh;
    abstract readonly hitMesh:         Mesh;
    // Primary output resource (null = delivery-only destination like Homebase for inputs).
    abstract readonly providesResource: Resource | null;

    readonly surfaceNormal: Vector3;

    constructor(surfaceNormal: Vector3) {
        this.surfaceNormal = surfaceNormal.clone().normalize();
    }

    get position(): Vector3 { return this.mesh.position; }

    // truckCount = transports currently routing to this structure as their source.
    abstract getStatsLines(truckCount: number): string[];
    abstract dispose(): void;

    // 0–100 utilization based on input-resource availability.
    // limitedBy = name of the bottleneck resource, or null if at full capacity.
    getUtilization(): { pct: number; limitedBy: string | null } {
        return { pct: 100, limitedBy: null };
    }

    // Role this structure plays for a given resource.
    // null = structure has no relationship with this resource.
    // Override in subclasses to declare inventory semantics.
    getResourceRole(_resource: Resource): InventoryRole | null {
        return null;
    }

    // Time (seconds) to craft one batch of this structure's output. Placeholder
    // default of 1s; override per structure/output. Drives the hover progress bar.
    get craftSeconds(): number { return 1; }

    // Progress [0,1] through the current craft cycle, or null if this structure
    // does not craft an output from inputs (e.g. storage, raw deposit).
    craftProgress01(): number | null { return null; }
}
