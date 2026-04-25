import {
    Scene, Mesh, Vector3,
    BoxGeometry, MeshStandardMaterial, MeshBasicMaterial,
} from 'three';
import { R, SURFACE_RISE, PAD_W, PAD_H } from './constants';
import { Resource } from './resource';
import { Structure, InventoryRole } from './structure';

export class ResourceNode extends Structure {
    readonly label:           string;
    readonly mesh:            Mesh;
    readonly hitMesh:         Mesh;
    readonly providesResource: Resource;

    constructor(scene: Scene, resource: Resource, surfaceNormal: Vector3) {
        super(surfaceNormal);
        this.label            = resource.name;
        this.providesResource = resource;

        const pos = this.surfaceNormal.clone()
            .multiplyScalar(R + SURFACE_RISE + PAD_H / 2);

        this.mesh = new Mesh(
            new BoxGeometry(PAD_W, PAD_H, PAD_W),
            new MeshStandardMaterial({ color: resource.color, roughness: 0.7 }),
        );
        this.mesh.position.copy(pos);
        this.mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), this.surfaceNormal);
        scene.add(this.mesh);
        resource.mesh = this.mesh;

        this.hitMesh = new Mesh(
            new BoxGeometry(PAD_W * 4, PAD_H, PAD_W * 4),
            new MeshBasicMaterial({ visible: false }),
        );
        this.hitMesh.position.copy(pos);
        this.hitMesh.quaternion.copy(this.mesh.quaternion);
        this.hitMesh.userData['resource']  = resource;
        this.hitMesh.userData['structure'] = this;
        scene.add(this.hitMesh);
        resource.hitMesh = this.hitMesh;
    }

    getResourceRole(resource: Resource): InventoryRole | null {
        return resource === this.providesResource ? 'output' : null;
    }

    getStatsLines(truckCount: number): string[] {
        const res = this.providesResource;
        const remaining = res.total - res.gathered;
        const fmt = (n: number) =>
            n >= 1_000_000_000_000 ? `${(n / 1_000_000_000_000).toFixed(2)} Gt`
          : n >= 1_000_000_000     ? `${(n / 1_000_000_000).toFixed(2)} Mt`
          : n >= 1_000_000         ? `${(n / 1_000_000).toFixed(2)} kt`
          : n >= 1_000             ? `${(n / 1_000).toFixed(1)} t`
          : `${n} kg`;
        const lines = [
            res.name,
            `remaining  ${fmt(remaining)} / ${fmt(res.total)}`,
            `tap yield  ${res.gatherAmount} kg`,
        ];
        if (truckCount > 0) lines.push(`trucks  ${truckCount}`);
        return lines;
    }

    dispose(): void {
        this.mesh.parent?.remove(this.mesh);
        this.hitMesh.parent?.remove(this.hitMesh);
    }
}
