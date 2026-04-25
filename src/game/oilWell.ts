import {
    Scene, Mesh, Vector3,
    BoxGeometry, MeshStandardMaterial, MeshBasicMaterial,
} from 'three';
import { R, SURFACE_RISE } from './constants';
import { Resource } from './resource';
import { Structure, InventoryRole } from './structure';

export const OIL_WELL_W          = 8;        // m
export const OIL_WELL_H          = 30;       // m (derrick height)
export const OIL_WELL_D          = 8;        // m
// ~150 t structural steel: drill casing + wellhead + surface facilities (onshore well)
export const OIL_WELL_STEEL_COST = 150_000;  // kg steel

export interface OilWellSave {
    nx: number; ny: number; nz: number;
}

export class OilWell extends Structure {
    readonly label            = 'Oil Well';
    readonly mesh:             Mesh;
    readonly hitMesh:          Mesh;
    readonly providesResource: Resource;

    constructor(
        scene:         Scene,
        surfaceNormal: Vector3,
        oil:           Resource,
    ) {
        super(surfaceNormal);
        this.providesResource = oil;

        const pos = this.surfaceNormal.clone()
            .multiplyScalar(R + SURFACE_RISE + OIL_WELL_H / 2);

        this.mesh = new Mesh(
            new BoxGeometry(OIL_WELL_W, OIL_WELL_H, OIL_WELL_D),
            new MeshStandardMaterial({ color: 0x37474f, metalness: 0.5, roughness: 0.6 }),
        );
        this.mesh.position.copy(pos);
        this.mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), this.surfaceNormal);
        this.mesh.userData['oilWell']   = this;
        this.mesh.userData['structure'] = this;
        scene.add(this.mesh);

        this.hitMesh = new Mesh(
            new BoxGeometry(OIL_WELL_W * 4, OIL_WELL_H, OIL_WELL_D * 4),
            new MeshBasicMaterial({ visible: false }),
        );
        this.hitMesh.position.copy(pos);
        this.hitMesh.quaternion.copy(this.mesh.quaternion);
        this.hitMesh.userData['oilWell']   = this;
        this.hitMesh.userData['structure'] = this;
        scene.add(this.hitMesh);

        oil.mesh    = this.mesh;
        oil.hitMesh = this.hitMesh;
    }

    getResourceRole(resource: Resource): InventoryRole | null {
        return resource === this.providesResource ? 'output' : null;
    }

    getUtilization(): { pct: number; limitedBy: string | null } {
        const oil = this.providesResource;
        if (oil && oil.gathered >= oil.total) return { pct: 0, limitedBy: 'Deposit exhausted' };
        return { pct: 100, limitedBy: null };
    }

    getStatsLines(truckCount: number): string[] {
        const lines = [
            'Oil Well',
            'Deposit: 1 Gt crude oil',
            'Energy:  42.7 MJ/kg',
        ];
        if (truckCount > 0) lines.push(`trucks  ${truckCount}`);
        return lines;
    }

    toJSON(): OilWellSave {
        return {
            nx: this.surfaceNormal.x,
            ny: this.surfaceNormal.y,
            nz: this.surfaceNormal.z,
        };
    }

    static fromJSON(
        save:      OilWellSave,
        scene:     Scene,
        resources: Resource[],
    ): OilWell {
        const oil = resources.find(r => r.name === 'Oil')!;
        return new OilWell(scene, new Vector3(save.nx, save.ny, save.nz), oil);
    }

    dispose(): void {
        this.mesh.parent?.remove(this.mesh);
        this.hitMesh.parent?.remove(this.hitMesh);
    }
}
