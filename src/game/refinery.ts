import {
    Scene, Mesh, Vector3,
    BoxGeometry, MeshStandardMaterial, MeshBasicMaterial,
} from 'three';
import { R, SURFACE_RISE } from './constants';
import { Resource, formatScaled } from './resource';
import { Structure, InventoryRole } from './structure';

// ── Geometry ──────────────────────────────────────────────────────────────────
export const REFINERY_W = 20;
export const REFINERY_H = 30;
export const REFINERY_D = 20;

// ── Build cost ────────────────────────────────────────────────────────────────
export const REFINERY_IRON_COST  = 5_000;
export const REFINERY_STONE_COST = 50_000;

// ── Recipe system ─────────────────────────────────────────────────────────────

export interface InputSpec {
    resourceName: string;
    kgPerBatch:   number;
}

export interface RefineryRecipe {
    id:               string;
    outputName:       string;
    outputKgPerBatch: number;
    batchSeconds:     number;
    fixedInputs:      InputSpec[];
    // MJ of external fuel needed per batch. 0 = self-fueled (no fuelResource required).
    energyMJPerBatch: number;
}

// Modern blast-furnace + BOF steelmaking (per 1 t steel):
//   Iron ore 1.5 t, met. coke 0.6 t, external heat ~20 GJ
export const STEEL_RECIPE: RefineryRecipe = {
    id:               'Steel',
    outputName:       'Steel',
    outputKgPerBatch: 1_000,
    batchSeconds:     60,
    fixedInputs: [
        { resourceName: 'Iron', kgPerBatch: 1_500 },
        { resourceName: 'Coal', kgPerBatch:   600 },
    ],
    energyMJPerBatch: 20_000,  // 20 MJ/kg × 1000 kg
};

// Atmospheric distillation + hydrocracking (per 1 t gasoline):
//   ~75% liquid-product yield; 333 kg crude burned as process fuel internally.
//   100 kg coal provides catalytic-cracking heat supplement.
//   Self-fueled: the 333 kg crude fraction supplies ~14,221 MJ process heat.
export const GASOLINE_RECIPE: RefineryRecipe = {
    id:               'Gasoline',
    outputName:       'Gasoline',
    outputKgPerBatch: 1_000,
    batchSeconds:     60,
    fixedInputs: [
        { resourceName: 'Oil',  kgPerBatch: 1_333 },
        { resourceName: 'Coal', kgPerBatch:   100 },
    ],
    energyMJPerBatch: 0,  // self-fueled; 333 kg crude fraction supplies process heat
};

export const REFINERY_RECIPES: RefineryRecipe[] = [STEEL_RECIPE, GASOLINE_RECIPE];

// ── Serialization ─────────────────────────────────────────────────────────────

export interface RefinerySave {
    id:           number;
    recipeId:     string;
    fuelResource: string;   // empty string when self-fueled
    timer:        number;
    nx: number; ny: number; nz: number;
}

// ── Class ─────────────────────────────────────────────────────────────────────

let _nextRefineryId = 1;

export class Refinery extends Structure {
    static readonly W = REFINERY_W;
    static readonly H = REFINERY_H;
    static readonly D = REFINERY_D;

    readonly label:            string;
    readonly mesh:             Mesh;
    readonly hitMesh:          Mesh;
    readonly providesResource: Resource;

    readonly recipe:       RefineryRecipe;
    readonly id:           number;
    readonly fuelResource: Resource | null;  // null when energyMJPerBatch === 0

    private readonly fixedInputs: { resource: Resource; kgPerBatch: number }[];
    private timer = 0;

    fuelKgPerBatch(): number {
        if (!this.fuelResource || this.recipe.energyMJPerBatch === 0) return 0;
        return this.recipe.energyMJPerBatch / this.fuelResource.energyDensityMJkg;
    }

    // All distinct resources consumed each batch. The fuel may also be a fixed
    // input (e.g. Coal in the steel recipe), so de-dupe to list it once.
    get inputResources(): Resource[] {
        const inputs = this.fixedInputs.map(i => i.resource);
        if (this.fuelResource && !inputs.includes(this.fuelResource)) inputs.push(this.fuelResource);
        return inputs;
    }

    getResourceRole(resource: Resource): InventoryRole | null {
        if (resource === this.providesResource) return 'output';
        if (this.inputResources.some(r => r === resource)) return 'input';
        return null;
    }

    // Craft time = this recipe's batch duration (per output + structure).
    get craftSeconds(): number { return this.recipe.batchSeconds; }
    craftProgress01(): number { return Math.min(1, this.timer / this.recipe.batchSeconds); }

    constructor(
        scene:         Scene,
        surfaceNormal: Vector3,
        recipe:        RefineryRecipe,
        resources:     Resource[],
        fuelResource:  Resource | null,
        id?:           number,
    ) {
        super(surfaceNormal);
        this.id           = id ?? _nextRefineryId++;
        if (this.id >= _nextRefineryId) _nextRefineryId = this.id + 1;
        this.label        = `Refinery #${this.id}: ${recipe.outputName}`;
        this.recipe       = recipe;
        this.fuelResource = fuelResource;
        this.fixedInputs  = recipe.fixedInputs.map(spec => ({
            resource:   resources.find(r => r.name === spec.resourceName)!,
            kgPerBatch: spec.kgPerBatch,
        }));
        this.providesResource = resources.find(r => r.name === recipe.outputName)!;

        const pos = this.surfaceNormal.clone()
            .multiplyScalar(R + SURFACE_RISE + REFINERY_H / 2);

        this.mesh = new Mesh(
            new BoxGeometry(REFINERY_W, REFINERY_H, REFINERY_D),
            new MeshStandardMaterial({ color: 0x546e7a, metalness: 0.6, roughness: 0.4 }),
        );
        this.mesh.position.copy(pos);
        this.mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), this.surfaceNormal);
        this.mesh.userData['refinery']  = this;
        this.mesh.userData['structure'] = this;
        scene.add(this.mesh);

        this.hitMesh = new Mesh(
            new BoxGeometry(REFINERY_W * 3, REFINERY_H, REFINERY_D * 3),
            new MeshBasicMaterial({ visible: false }),
        );
        this.hitMesh.position.copy(pos);
        this.hitMesh.quaternion.copy(this.mesh.quaternion);
        this.hitMesh.userData['refinery']  = this;
        this.hitMesh.userData['structure'] = this;
        scene.add(this.hitMesh);
    }

    tick(dt: number): { produced: boolean; reason?: string } {
        this.timer += dt;
        if (this.timer < this.recipe.batchSeconds) return { produced: false };
        this.timer -= this.recipe.batchSeconds;

        for (const inp of this.fixedInputs) {
            if (inp.resource.gathered < inp.kgPerBatch) {
                return { produced: false, reason: `Low ${inp.resource.name}` };
            }
        }
        const fuelNeeded = this.fuelKgPerBatch();
        if (fuelNeeded > 0 && this.fuelResource && this.fuelResource.gathered < fuelNeeded) {
            return { produced: false, reason: `Low ${this.fuelResource.name}` };
        }

        for (const inp of this.fixedInputs) inp.resource.consume(inp.kgPerBatch);
        if (fuelNeeded > 0 && this.fuelResource) this.fuelResource.consume(fuelNeeded);
        this.providesResource.produce(this.recipe.outputKgPerBatch);
        return { produced: true };
    }

    getUtilization(): { pct: number; limitedBy: string | null } {
        let minRatio  = 1;
        let limitedBy: string | null = null;
        for (const inp of this.fixedInputs) {
            const ratio = inp.resource.gathered / inp.kgPerBatch;
            if (ratio < minRatio) { minRatio = ratio; limitedBy = inp.resource.name; }
        }
        const fuelKg = this.fuelKgPerBatch();
        if (fuelKg > 0 && this.fuelResource) {
            const ratio = this.fuelResource.gathered / fuelKg;
            if (ratio < minRatio) { minRatio = ratio; limitedBy = this.fuelResource.name; }
        }
        return { pct: Math.round(Math.min(1, Math.max(0, minRatio)) * 100), limitedBy };
    }

    getStatsLines(truckCount: number): string[] {
        const lines: string[] = [
            this.label,
            `Output: ${formatScaled(this.recipe.outputKgPerBatch, 'kg')} ${this.recipe.outputName} / ${this.recipe.batchSeconds}s`,
        ];
        for (const inp of this.fixedInputs) {
            lines.push(`${inp.resource.name}:  ${formatScaled(inp.kgPerBatch, 'kg')}/batch`);
        }
        if (this.fuelResource) {
            lines.push(`Fuel (auto):  ${this.fuelResource.name}  ${formatScaled(this.fuelKgPerBatch(), 'kg')}/batch`);
        } else {
            lines.push('Fuel:  self-fueled');
        }
        if (truckCount > 0) lines.push(`trucks  ${truckCount}`);
        return lines;
    }

    toJSON(): RefinerySave {
        return {
            id:           this.id,
            recipeId:     this.recipe.id,
            fuelResource: this.fuelResource?.name ?? '',
            timer:        this.timer,
            nx: this.surfaceNormal.x,
            ny: this.surfaceNormal.y,
            nz: this.surfaceNormal.z,
        };
    }

    static fromJSON(save: RefinerySave, scene: Scene, resources: Resource[]): Refinery {
        // Backward compat: old saves have no recipeId (was always Steel); 'Diesel' renamed to 'Gasoline'
        const rawId    = (save as any).recipeId ?? 'Steel';
        const recipeId = rawId === 'Diesel' ? 'Gasoline' : rawId;
        const recipe   = REFINERY_RECIPES.find(r => r.id === recipeId) ?? STEEL_RECIPE;
        const fuel     = save.fuelResource
            ? (resources.find(r => r.name === save.fuelResource) ?? null)
            : null;
        const savedId  = (save as any).id as number | undefined;
        const ref      = new Refinery(scene, new Vector3(save.nx, save.ny, save.nz), recipe, resources, fuel, savedId);
        ref.timer      = save.timer;
        return ref;
    }

    dispose(): void {
        this.mesh.parent?.remove(this.mesh);
        this.hitMesh.parent?.remove(this.hitMesh);
    }
}
