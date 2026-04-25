import {
    Scene, Mesh, Vector3,
    BoxGeometry, MeshStandardMaterial, MeshBasicMaterial,
} from 'three';
import { R, SURFACE_RISE } from './constants';
import { Resource } from './resource';
import { Structure, InventoryRole } from './structure';

export const POWER_PLANT_W = 30;
export const POWER_PLANT_H = 40;
export const POWER_PLANT_D = 30;

export const POWER_PLANT_IRON_COST  = 10_000;
export const POWER_PLANT_STONE_COST = 100_000;

const BATCH_KG_FUEL = 1_000;
const BATCH_SECONDS = 60;

// Real-world thermal efficiency (electrical output / fuel heat input)
// Wood:     ~25%  — wood-fired steam turbine (Rankine cycle, low-grade steam)
// Coal:     ~38%  — subcritical pulverised-coal plant
// Oil:      ~40%  — oil-fired steam turbine (residual fuel oil)
// Gasoline: ~35%  — reciprocating diesel/gas-engine generator set
const THERMAL_EFFICIENCY: Record<string, number> = {
    Wood:     0.25,
    Coal:     0.38,
    Oil:      0.40,
    Gasoline: 0.35,
};

export interface PowerPlantSave {
    fuelName: string;
    timer:    number;
    nx: number; ny: number; nz: number;
}

export class PowerPlant extends Structure {
    readonly label = 'Power Plant';
    readonly mesh:             Mesh;
    readonly hitMesh:          Mesh;
    readonly providesResource: Resource;  // Electricity
    readonly fuelResource:     Resource;

    readonly efficiency:  number;
    readonly kwhPerBatch: number;

    private timer = 0;

    constructor(
        scene:         Scene,
        surfaceNormal: Vector3,
        fuelResource:  Resource,
        electricity:   Resource,
    ) {
        super(surfaceNormal);
        this.fuelResource     = fuelResource;
        this.providesResource = electricity;
        this.efficiency       = THERMAL_EFFICIENCY[fuelResource.name] ?? 0.30;
        // kWh = kg × MJ/kg × η / 3.6  (1 kWh = 3.6 MJ)
        this.kwhPerBatch = BATCH_KG_FUEL * fuelResource.energyDensityMJkg * this.efficiency / 3.6;

        const pos = this.surfaceNormal.clone()
            .multiplyScalar(R + SURFACE_RISE + POWER_PLANT_H / 2);

        this.mesh = new Mesh(
            new BoxGeometry(POWER_PLANT_W, POWER_PLANT_H, POWER_PLANT_D),
            new MeshStandardMaterial({ color: 0xc62828, metalness: 0.4, roughness: 0.6 }),
        );
        this.mesh.position.copy(pos);
        this.mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), this.surfaceNormal);
        this.mesh.userData['powerPlant'] = this;
        this.mesh.userData['structure']  = this;
        scene.add(this.mesh);

        this.hitMesh = new Mesh(
            new BoxGeometry(POWER_PLANT_W * 3, POWER_PLANT_H, POWER_PLANT_D * 3),
            new MeshBasicMaterial({ visible: false }),
        );
        this.hitMesh.position.copy(pos);
        this.hitMesh.quaternion.copy(this.mesh.quaternion);
        this.hitMesh.userData['powerPlant'] = this;
        this.hitMesh.userData['structure']  = this;
        scene.add(this.hitMesh);
    }

    getResourceRole(resource: Resource): InventoryRole | null {
        if (resource === this.providesResource) return 'output';
        if (resource === this.fuelResource)     return 'input';
        return null;
    }

    tick(dt: number): { produced: boolean } {
        this.timer += dt;
        if (this.timer < BATCH_SECONDS) return { produced: false };
        this.timer -= BATCH_SECONDS;
        if (this.fuelResource.gathered < BATCH_KG_FUEL) return { produced: false };
        this.fuelResource.consume(BATCH_KG_FUEL);
        this.providesResource.deposit(this.kwhPerBatch);
        return { produced: true };
    }

    getUtilization(): { pct: number; limitedBy: string | null } {
        const ratio = this.fuelResource.gathered / BATCH_KG_FUEL;
        if (ratio >= 1) return { pct: 100, limitedBy: null };
        return { pct: Math.round(ratio * 100), limitedBy: this.fuelResource.name };
    }

    getStatsLines(truckCount: number): string[] {
        const lines = [
            'Power Plant',
            `Fuel: ${this.fuelResource.name}  (η = ${Math.round(this.efficiency * 100)}%)`,
            `Output: ${this.kwhPerBatch.toFixed(0)} kWh / ${BATCH_SECONDS}s`,
            `Fuel: ${BATCH_KG_FUEL} kg / ${BATCH_SECONDS}s`,
        ];
        if (truckCount > 0) lines.push(`trucks  ${truckCount}`);
        return lines;
    }

    toJSON(): PowerPlantSave {
        return {
            fuelName: this.fuelResource.name,
            timer:    this.timer,
            nx: this.surfaceNormal.x,
            ny: this.surfaceNormal.y,
            nz: this.surfaceNormal.z,
        };
    }

    static fromJSON(save: PowerPlantSave, scene: Scene, resources: Resource[]): PowerPlant {
        const fuel        = resources.find(r => r.name === save.fuelName)!;
        const electricity = resources.find(r => r.name === 'Electricity')!;
        const pp = new PowerPlant(scene, new Vector3(save.nx, save.ny, save.nz), fuel, electricity);
        pp.timer = save.timer;
        return pp;
    }

    dispose(): void {
        this.mesh.parent?.remove(this.mesh);
        this.hitMesh.parent?.remove(this.hitMesh);
    }
}
