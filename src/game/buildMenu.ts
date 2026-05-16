import { Scene, Vector3, Mesh, BoxGeometry, MeshStandardMaterial } from 'three';
import { R, SURFACE_RISE, PAD_W } from './constants';
import { Resource, formatScaled } from './resource';
import { Transport, TruckTransport, resolveSourceNormal } from './transport';
import { TECH_TREE } from './tech';
import { Structure, InventoryRole } from './structure';
import { Homebase } from './homebase';
import { ResourceNode } from './resourceNode';
import { Refinery, RefineryRecipe, REFINERY_RECIPES, REFINERY_W, REFINERY_H, REFINERY_D, REFINERY_IRON_COST, REFINERY_STONE_COST } from './refinery';
import { OilWell, OIL_WELL_W, OIL_WELL_H, OIL_WELL_D, OIL_WELL_STEEL_COST } from './oilWell';
import { PowerPlant, POWER_PLANT_W, POWER_PLANT_H, POWER_PLANT_D, POWER_PLANT_IRON_COST, POWER_PLANT_STONE_COST } from './powerPlant';

type BuildStep = 'closed' | 'panel' | 'truck_dest' | 'truck_resource' | 'select_refinery_fuel' | 'select_powerplant_fuel';

interface ModalOption {
    label:    string;
    sub?:     string;
    color:    string;
    disabled: boolean;
    onClick:  () => void;
}

export class BuildMenu {
    private step: BuildStep = 'closed';

    // Truck build flow state
    private truckDest:         Structure | null = null;
    private truckDestName      = '';
    private truckResource:     Resource | null  = null;
    private truckSourceNormal: Vector3 | null   = null;

    private panel!:        HTMLElement;
    private modal!:        HTMLElement;
    private modalTitle!:   HTMLElement;
    private modalOptions!: HTMLElement;
    private truckCostEl!:  HTMLElement;
    private truckFuelEl!:  HTMLElement;
    private truckBtn!:     HTMLButtonElement;
    private refineryCostEl!:      HTMLElement;
    private refineryStCostEl!:    HTMLElement;
    private refineryBtn!:         HTMLButtonElement;
    private oilWellCostEl!:       HTMLElement;
    private oilWellBtn!:          HTMLButtonElement;
    private powerPlantCostEl!:    HTMLElement;
    private powerPlantStCostEl!:  HTMLElement;
    private powerPlantBtn!:       HTMLButtonElement;

    // Set after construction once InputHandler is available
    private onRequestPlacement: (
        ghost:    Mesh,
        rise:     number,
        callback: (normal: Vector3) => void,
        validator?: (normal: Vector3) => boolean,
        invalidMessage?: string,
    ) => void = () => {};

    constructor(
        private resources:           Resource[],
        private homeNormal:          Vector3,
        private scene:               Scene,
        private structures:          Structure[],
        private onBuild:             (t: Transport)    => void,
        private onBuildRefinery:     (r: Refinery)     => void,
        private onBuildOilWell:      (w: OilWell)      => void,
        private onBuildPowerPlant:   (p: PowerPlant)   => void,
        private onHudDirty:          (res: Resource)   => void,
    ) {
        this._buildDOM();
        this._refreshPanel();
    }

    setPlacementHandler(
        fn: (ghost: Mesh, rise: number, cb: (n: Vector3) => void, validator?: (n: Vector3) => boolean, invalidMessage?: string) => void,
    ): void {
        this.onRequestPlacement = fn;
    }

    tick(): void {
        if (this.step === 'panel') this._refreshPanel();
    }

    // ── DOM ───────────────────────────────────────────────────────────────────

    private _buildDOM(): void {
        document.getElementById('btn-build')!.addEventListener('click', () => this._toggle());

        this.panel        = document.getElementById('build-panel')!;
        this.modal        = document.getElementById('build-modal')!;
        this.modalTitle   = document.getElementById('bm-modal-title')!;
        this.modalOptions = document.getElementById('bm-modal-options')!;
        this.truckCostEl  = document.getElementById('bm-truck-cost')!;
        this.truckFuelEl  = document.getElementById('bm-truck-fuel')!;
        this.truckBtn     = document.getElementById('bm-truck-btn') as HTMLButtonElement;
        this.refineryCostEl   = document.getElementById('bm-refinery-cost')!;
        this.refineryStCostEl = document.getElementById('bm-refinery-stone-cost')!;
        this.refineryBtn      = document.getElementById('bm-refinery-btn') as HTMLButtonElement;
        this.oilWellCostEl    = document.getElementById('bm-oilwell-cost')!;
        this.oilWellBtn       = document.getElementById('bm-oilwell-btn') as HTMLButtonElement;
        this.powerPlantCostEl   = document.getElementById('bm-powerplant-cost')!;
        this.powerPlantStCostEl = document.getElementById('bm-powerplant-stone-cost')!;
        this.powerPlantBtn      = document.getElementById('bm-powerplant-btn') as HTMLButtonElement;

        document.getElementById('bm-panel-close')!.addEventListener('click', () => this._close());
        document.getElementById('bm-modal-cancel')!.addEventListener('click', () => this._close());

        this.truckBtn.addEventListener('click',       () => this._startBuildTruck());
        this.refineryBtn.addEventListener('click',    () => this._startBuildRefinery());
        this.oilWellBtn.addEventListener('click',     () => this._startBuildOilWell());
        this.powerPlantBtn.addEventListener('click',  () => this._startBuildPowerPlant());
    }

    // ── State transitions ─────────────────────────────────────────────────────

    private _toggle(): void {
        if (this.step === 'closed') {
            this.step = 'panel';
            this._refreshPanel();
            this.panel.classList.remove('bm-hidden');
        } else {
            this._close();
        }
    }

    private _close(): void {
        this.step             = 'closed';
        this.truckDest        = null;
        this.truckResource    = null;
        this.truckSourceNormal = null;
        this.panel.classList.add('bm-hidden');
        this.modal.classList.add('bm-hidden');
    }

    // ── Truck build flow ──────────────────────────────────────────────────────
    // Step 1: pick destination structure
    // Step 2: pick resource (filtered to what that destination needs)
    // Step 3: pick truck fuel

    private _startBuildTruck(): void {
        if (this._iron().gathered < TruckTransport.IRON_COST) return;
        this.step = 'truck_dest';
        this.panel.classList.add('bm-hidden');

        // Any structure that accepts at least one resource as input is a valid destination
        const dests: ModalOption[] = [];
        for (const s of this.structures) {
            const inputRes = this.resources.filter(r => {
                const role = s.getResourceRole(r);
                return role === 'input' || role === 'both';
            });
            if (!inputRes.length) continue;

            const name  = this._destLabel(s);
            const color = this._destColor(s);
            dests.push({
                label:    name,
                sub:      `Accepts: ${inputRes.map(r => r.name).join(', ')}`,
                color,
                disabled: false,
                onClick:  () => this._pickTruckResource(s, name),
            });
        }

        this._showModal('Deliver to…', dests);
    }

    private _destLabel(s: Structure): string {
        if (s instanceof Homebase)    return s.label;
        if (s instanceof Refinery)    return `Refinery – ${s.recipe.outputName}`;
        if (s instanceof PowerPlant)  return `Power Plant (${s.fuelResource.name})`;
        return s.label;
    }

    private _destColor(s: Structure): string {
        if (s instanceof Homebase)    return '#aaaaaa';
        if (s instanceof Refinery)    return '#546e7a';
        if (s instanceof PowerPlant)  return '#c62828';
        return '#888888';
    }

    // Step 2: pick resource to haul to destStructure
    private _pickTruckResource(dest: Structure, destName: string): void {
        this.truckDest     = dest;
        this.truckDestName = destName;
        this.step          = 'truck_resource';

        const destNormal = dest.surfaceNormal;
        // Resources the destination accepts as input, filtered to those with an output source
        const needed = this.resources.filter(r => {
            const destRole = dest.getResourceRole(r);
            if (destRole !== 'input' && destRole !== 'both') return false;
            // Must have at least one structure that can OUTPUT this resource (not 'both'/Homebase)
            return this.structures.some(s => s.getResourceRole(r) === 'output');
        });

        this._showModal(`Haul to ${destName}…`,
            needed.map(res => {
                const srcNormal = resolveSourceNormal(res, this.structures, destNormal, destNormal);
                const distKm    = (Math.acos(Math.min(1, Math.max(-1, destNormal.dot(srcNormal)))) * R / 1000).toFixed(1);
                return {
                    label:    res.name,
                    sub:      `Source ${distKm} km from destination`,
                    color:    res.hex,
                    disabled: false,
                    onClick:  () => {
                        this.truckResource     = res;
                        this.truckSourceNormal = resolveSourceNormal(res, this.structures, destNormal, destNormal);
                        this._buildTruck(this._autoFuel());
                    },
                };
            }),
        );
    }

    // Auto-selects the most energy-dense unlocked fuel that has stock.
    // Falls back to the highest-grade unlocked fuel if none have stock.
    private _autoFuel(): Resource {
        const names    = TECH_TREE.unlockedFuelNames();
        const unlocked = this.resources.filter(r => r.isFuel && names.includes(r.name));
        const withStock = unlocked.filter(f => f.gathered > 0);
        const pool = withStock.length > 0 ? withStock : unlocked;
        return pool.reduce((best, f) =>
            f.energyDensityMJkg > best.energyDensityMJkg ? f : best,
        );
    }

    private _buildTruck(fuel: Resource): void {
        const iron = this._iron();
        iron.consume(TruckTransport.IRON_COST);
        this.onHudDirty(iron);
        this.onBuild(new TruckTransport(
            this.scene,
            this.truckDest!.surfaceNormal,
            this.truckResource!,
            fuel,
            this.truckSourceNormal!,
            this.truckDestName,
        ));
        this._close();
    }

    // ── Refinery build flow ───────────────────────────────────────────────────

    private _startBuildRefinery(): void {
        const iron  = this._iron();
        const stone = this._stone();
        if (iron.gathered < REFINERY_IRON_COST || stone.gathered < REFINERY_STONE_COST) return;

        this.step = 'select_refinery_fuel';
        this.panel.classList.add('bm-hidden');

        this._showModal('Select output product…',
            REFINERY_RECIPES.map(recipe => {
                const fuel    = this._bestFuel(recipe);
                const fuelKg  = fuel
                    ? (recipe.energyMJPerBatch / fuel.energyDensityMJkg).toFixed(1)
                    : null;
                const inputDesc = recipe.fixedInputs
                    .map(i => `${formatScaled(i.kgPerBatch, 'kg')} ${i.resourceName}`)
                    .join(', ');
                const fuelDesc = fuelKg
                    ? `  ·  fuel: ${fuel!.name} ${formatScaled(Number(fuelKg), 'kg')} (auto)`
                    : '  ·  self-fueled';
                const outputRes = this.resources.find(r => r.name === recipe.outputName);
                return {
                    label:    `${recipe.outputName}  ×  ${formatScaled(recipe.outputKgPerBatch, 'kg')} / ${recipe.batchSeconds}s`,
                    sub:      `inputs: ${inputDesc}${fuelDesc}`,
                    color:    outputRes?.hex ?? '#888888',
                    disabled: false,
                    onClick:  () => this._enterRefineryPlacement(recipe, fuel),
                };
            }),
        );
    }

    // Returns the most energy-dense fuel the player currently has stocked,
    // or falls back to the highest-density fuel if none are in stock.
    // Returns null for self-fueled recipes (energyMJPerBatch === 0).
    private _bestFuel(recipe: RefineryRecipe): Resource | null {
        if (recipe.energyMJPerBatch === 0) return null;
        const fuels = this.resources.filter(r => r.isFuel);
        const withStock = fuels.filter(f => f.gathered > 0);
        const candidates = withStock.length > 0 ? withStock : fuels;
        return candidates.reduce((best, f) =>
            f.energyDensityMJkg > best.energyDensityMJkg ? f : best,
        );
    }

    private _enterRefineryPlacement(recipe: RefineryRecipe, fuel: Resource | null): void {
        this.modal.classList.add('bm-hidden');

        const ghost = new Mesh(
            new BoxGeometry(REFINERY_W, REFINERY_H, REFINERY_D),
            new MeshStandardMaterial({
                color: 0x546e7a, metalness: 0.5, roughness: 0.5,
                transparent: true, opacity: 0.55,
            }),
        );

        this.onRequestPlacement(ghost, SURFACE_RISE + REFINERY_H / 2, (normal: Vector3) => {
            const iron  = this._iron();
            const stone = this._stone();
            iron.consume(REFINERY_IRON_COST);
            stone.consume(REFINERY_STONE_COST);
            this.onHudDirty(iron);
            this.onHudDirty(stone);
            this.onBuildRefinery(new Refinery(this.scene, normal, recipe, this.resources, fuel));
            this.step = 'closed';
        });
    }

    // ── Oil Well build flow ───────────────────────────────────────────────────

    private _startBuildOilWell(): void {
        const steel = this._steel();
        if (steel.gathered < OIL_WELL_STEEL_COST) return;

        this.panel.classList.add('bm-hidden');
        this._enterOilWellPlacement();
    }

    private _enterOilWellPlacement(): void {
        const ghost = new Mesh(
            new BoxGeometry(OIL_WELL_W, OIL_WELL_H, OIL_WELL_D),
            new MeshStandardMaterial({
                color: 0x37474f, metalness: 0.5, roughness: 0.5,
                transparent: true, opacity: 0.55,
            }),
        );

        const rise = SURFACE_RISE + OIL_WELL_H / 2;

        // Find natural Oil resource node — placement must be on top of it.
        const oilNode = this.structures.find(
            s => s instanceof ResourceNode && (s as ResourceNode).providesResource.name === 'Oil',
        ) as ResourceNode | undefined;
        const validator = (n: Vector3) => {
            if (!oilNode) return false;
            const dot = Math.min(1, Math.max(-1, oilNode.surfaceNormal.dot(n)));
            return Math.acos(dot) * R < PAD_W;
        };

        this.onRequestPlacement(ghost, rise, (normal: Vector3) => {
            const steel = this._steel();
            const oil   = this.resources.find(r => r.name === 'Oil')!;
            steel.consume(OIL_WELL_STEEL_COST);
            this.onHudDirty(steel);
            this.onBuildOilWell(new OilWell(this.scene, normal, oil));
            this.step = 'closed';
        }, validator, 'Oil well must be placed over an oil deposit');
    }

    // ── Power Plant build flow ────────────────────────────────────────────────

    private _startBuildPowerPlant(): void {
        const iron  = this._iron();
        const stone = this._stone();
        if (iron.gathered < POWER_PLANT_IRON_COST || stone.gathered < POWER_PLANT_STONE_COST) return;

        this.step = 'select_powerplant_fuel';
        this.panel.classList.add('bm-hidden');

        const fuels = this.resources.filter(r => r.isFuel && r.energyDensityMJkg > 0);
        this._showModal('Select fuel type…',
            fuels.map(f => {
                const eff: Record<string, number> = { Wood: 0.25, Coal: 0.38, Oil: 0.40, Gasoline: 0.35 };
                const eta    = eff[f.name] ?? 0.30;
                const kwhPer = (1_000 * f.energyDensityMJkg * eta / 3.6).toFixed(0);
                return {
                    label:    f.name,
                    sub:      `η = ${Math.round(eta * 100)}%  ·  ${kwhPer} kWh / 1 t fuel  ·  ${f.energyDensityMJkg} MJ/kg`,
                    color:    f.hex,
                    disabled: false,
                    onClick:  () => this._enterPowerPlantPlacement(f),
                };
            }),
        );
    }

    private _enterPowerPlantPlacement(fuel: Resource): void {
        this.modal.classList.add('bm-hidden');

        const ghost = new Mesh(
            new BoxGeometry(POWER_PLANT_W, POWER_PLANT_H, POWER_PLANT_D),
            new MeshStandardMaterial({
                color: 0xc62828, metalness: 0.4, roughness: 0.6,
                transparent: true, opacity: 0.55,
            }),
        );

        const rise = SURFACE_RISE + POWER_PLANT_H / 2;
        this.onRequestPlacement(ghost, rise, (normal: Vector3) => {
            const iron  = this._iron();
            const stone = this._stone();
            iron.consume(POWER_PLANT_IRON_COST);
            stone.consume(POWER_PLANT_STONE_COST);
            this.onHudDirty(iron);
            this.onHudDirty(stone);
            const electricity = this.resources.find(r => r.name === 'Electricity')!;
            this.onBuildPowerPlant(new PowerPlant(this.scene, normal, fuel, electricity));
            this.step = 'closed';
        });
    }

    // ── Panel refresh ─────────────────────────────────────────────────────────

    private _refreshPanel(): void {
        const have    = this._iron().gathered;
        const fmt     = (n: number) => formatScaled(n, 'kg');

        const truckOk  = have >= TruckTransport.IRON_COST;
        const autoFuel = this._autoFuel();
        this.truckCostEl.textContent  = `${fmt(have)} / ${fmt(TruckTransport.IRON_COST)} Iron`;
        this.truckCostEl.style.color  = truckOk ? '#8fbc8f' : '#bc8f8f';
        this.truckFuelEl.textContent  = `Fuel: ${autoFuel.name} (${autoFuel.energyDensityMJkg} MJ/kg)`;
        this.truckFuelEl.style.color  = '#666';
        this.truckBtn.disabled        = !truckOk;
        this.truckBtn.style.opacity   = truckOk ? '1' : '0.45';

        const haveStone   = this._stone().gathered;
        const refineryOk  = have >= REFINERY_IRON_COST && haveStone >= REFINERY_STONE_COST;
        this.refineryCostEl.textContent   = `${fmt(have)} / ${fmt(REFINERY_IRON_COST)} Iron`;
        this.refineryCostEl.style.color   = have >= REFINERY_IRON_COST ? '#8fbc8f' : '#bc8f8f';
        this.refineryStCostEl.textContent = `${fmt(haveStone)} / ${fmt(REFINERY_STONE_COST)} Stone`;
        this.refineryStCostEl.style.color = haveStone >= REFINERY_STONE_COST ? '#8fbc8f' : '#bc8f8f';
        this.refineryBtn.disabled         = !refineryOk;
        this.refineryBtn.style.opacity    = refineryOk ? '1' : '0.45';

        const haveSteel  = this._steel().gathered;
        const oilWellOk  = haveSteel >= OIL_WELL_STEEL_COST;
        this.oilWellCostEl.textContent = `${fmt(haveSteel)} / ${fmt(OIL_WELL_STEEL_COST)} Steel`;
        this.oilWellCostEl.style.color = oilWellOk ? '#8fbc8f' : '#bc8f8f';
        this.oilWellBtn.disabled       = !oilWellOk;
        this.oilWellBtn.style.opacity  = oilWellOk ? '1' : '0.45';

        const ppOk = have >= POWER_PLANT_IRON_COST && haveStone >= POWER_PLANT_STONE_COST;
        this.powerPlantCostEl.textContent   = `${fmt(have)} / ${fmt(POWER_PLANT_IRON_COST)} Iron`;
        this.powerPlantCostEl.style.color   = have >= POWER_PLANT_IRON_COST ? '#8fbc8f' : '#bc8f8f';
        this.powerPlantStCostEl.textContent = `${fmt(haveStone)} / ${fmt(POWER_PLANT_STONE_COST)} Stone`;
        this.powerPlantStCostEl.style.color = haveStone >= POWER_PLANT_STONE_COST ? '#8fbc8f' : '#bc8f8f';
        this.powerPlantBtn.disabled         = !ppOk;
        this.powerPlantBtn.style.opacity    = ppOk ? '1' : '0.45';
    }

    // ── Modal helper ──────────────────────────────────────────────────────────

    private _showModal(title: string, options: ModalOption[]): void {
        this.modalTitle.textContent = title;
        this.modalOptions.innerHTML = '';
        for (const opt of options) {
            const btn = document.createElement('button');
            btn.className     = 'bm-option';
            btn.disabled      = opt.disabled;
            btn.style.opacity = opt.disabled ? '0.4' : '1';

            const swatch = document.createElement('span');
            swatch.className        = 'bm-swatch';
            swatch.style.background = opt.color;

            const text = document.createElement('span');
            text.className   = 'bm-option-label';
            text.textContent = opt.label;
            btn.append(swatch, text);

            if (opt.sub) {
                const sub = document.createElement('span');
                sub.className   = 'bm-option-sub';
                sub.textContent = opt.sub;
                btn.appendChild(sub);
            }
            if (!opt.disabled) btn.addEventListener('click', opt.onClick);
            this.modalOptions.appendChild(btn);
        }
        this.modal.classList.remove('bm-hidden');
    }

    private _iron():  Resource { return this.resources.find(r => r.name === 'Iron')!; }
    private _stone(): Resource { return this.resources.find(r => r.name === 'Stone')!; }
    private _steel(): Resource { return this.resources.find(r => r.name === 'Steel')!; }
}
