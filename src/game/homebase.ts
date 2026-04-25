import {
    Scene, Mesh, Vector3,
    CylinderGeometry, MeshStandardMaterial,
} from 'three';
import { R, SURFACE_RISE, HOUSE_R, HOUSE_H } from './constants';
import { Resource } from './resource';
import { Structure, InventoryRole } from './structure';

export class Homebase extends Structure {
    readonly label           = 'Homebase';
    readonly mesh:             Mesh;
    readonly hitMesh:          Mesh;
    readonly providesResource  = null as null;

    constructor(scene: Scene, surfaceNormal: Vector3) {
        super(surfaceNormal);

        const pos = this.surfaceNormal.clone()
            .multiplyScalar(R + SURFACE_RISE + HOUSE_H / 2);

        this.mesh = new Mesh(
            new CylinderGeometry(HOUSE_R, HOUSE_R, HOUSE_H, 16),
            new MeshStandardMaterial({ color: 0xffd54f, metalness: 0.25, roughness: 0.6 }),
        );
        this.mesh.position.copy(pos);
        this.mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), this.surfaceNormal);
        this.mesh.userData['homebase']  = true;
        this.mesh.userData['structure'] = this;
        scene.add(this.mesh);

        // Use the visual mesh as the hit target (homebase is tapped directly).
        this.hitMesh = this.mesh;
    }

    // Homebase accepts and can re-supply all resources (global staging area).
    getResourceRole(_resource: Resource): InventoryRole { return 'both'; }

    // truckCount for homebase = all active trucks (they all deliver here).
    getStatsLines(truckCount: number): string[] {
        const lines: string[] = ['Homebase', 'Tap a resource to assign transports.'];
        if (truckCount > 0) lines.push(`trucks active  ${truckCount}`);
        return lines;
    }

    dispose(): void { this.mesh.parent?.remove(this.mesh); }
}
