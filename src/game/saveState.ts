import { Scene, Vector3 } from 'three';
import { Resource } from './resource';
import { ZoomController, ZoomSave } from './zoomController';
import { Transport, TransportSave, TruckTransport } from './transport';
import { Refinery, RefinerySave } from './refinery';
import { OilWell, OilWellSave } from './oilWell';
import { PowerPlant, PowerPlantSave } from './powerPlant';
import { TechTree } from './tech';

const SAVE_KEY   = 'gather_save_v7';
const V6_KEY     = 'gather_save_v6';
const V5_KEY     = 'gather_save_v5';
const V4_KEY     = 'gather_save_v4';
const V3_KEY     = 'gather_save_v3';
const V2_KEY     = 'gather_save_v2';
const LEGACY_KEY = 'gather_inventory_v1';

const ALL_KEYS = [SAVE_KEY, V6_KEY, V5_KEY, V4_KEY, V3_KEY, V2_KEY, LEGACY_KEY];

export function clearSave(): void {
    for (const key of ALL_KEYS) localStorage.removeItem(key);
}

interface GameSave {
    version:     7;
    inventory:   Record<string, number>;
    deposits:    Record<string, number>;
    camera:      ZoomSave;
    transports:  TransportSave[];
    refineries:  RefinerySave[];
    oilWells:    OilWellSave[];
    powerPlants: PowerPlantSave[];
    techs:       string[];
}

export function saveGame(
    zoom:        ZoomController,
    resources:   Resource[],
    transports:  Transport[],
    refineries:  Refinery[],
    oilWells:    OilWell[],
    powerPlants: PowerPlant[],
    techTree:    TechTree,
): void {
    const data: GameSave = {
        version:     7,
        inventory:   Object.fromEntries(resources.map(r => [r.name, r.gathered])),
        deposits:    Object.fromEntries(resources.filter(r => !r.isManufactured).map(r => [r.name, r.deposit])),
        camera:      zoom.toJSON(),
        transports:  transports.map(t => t.toJSON()),
        refineries:  refineries.map(r => r.toJSON()),
        oilWells:    oilWells.map(w => w.toJSON()),
        powerPlants: powerPlants.map(p => p.toJSON()),
        techs:       techTree.toJSON(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

export function loadGame(
    zoom:       ZoomController,
    resources:  Resource[],
    scene:      Scene,
    homeNormal: Vector3,
    techTree:   TechTree,
): { transports: Transport[]; refineries: Refinery[]; oilWells: OilWell[]; powerPlants: PowerPlant[] } {
    try {
        // v7 save (adds deposits)
        const raw7 = localStorage.getItem(SAVE_KEY);
        if (raw7) {
            const data = JSON.parse(raw7) as Partial<GameSave>;
            if (data.version === 7) return _applyV7(data as GameSave, zoom, resources, scene, homeNormal, techTree);
        }
        // v6 save (no deposits — leave at full)
        const raw6 = localStorage.getItem(V6_KEY);
        if (raw6) {
            const data = JSON.parse(raw6) as { version?: number; inventory?: Record<string, number>; camera?: ZoomSave; transports?: TransportSave[]; refineries?: RefinerySave[]; oilWells?: OilWellSave[]; powerPlants?: PowerPlantSave[]; techs?: string[] };
            if (data.version === 6) {
                _applyInventory(data.inventory ?? {}, resources);
                for (const id of (data.techs ?? [])) techTree.research(id);
                return {
                    transports:  _loadTransports(data.transports ?? [], scene, resources, homeNormal),
                    refineries:  (data.refineries  ?? []).map(rs => Refinery.fromJSON(rs, scene, resources)),
                    oilWells:    (data.oilWells    ?? []).map(ws => OilWell.fromJSON(ws, scene, resources)),
                    powerPlants: (data.powerPlants ?? []).map(ps => PowerPlant.fromJSON(ps, scene, resources)),
                };
            }
        }
        // v5 save (no techs)
        const raw5 = localStorage.getItem(V5_KEY);
        if (raw5) {
            const data = JSON.parse(raw5) as { version?: number; inventory?: Record<string, number>; camera?: ZoomSave; transports?: TransportSave[]; refineries?: RefinerySave[]; oilWells?: OilWellSave[]; powerPlants?: PowerPlantSave[] };
            if (data.version === 5) {
                _applyInventory(data.inventory ?? {}, resources);

                return {
                    transports:  _loadTransports(data.transports  ?? [], scene, resources, homeNormal),
                    refineries:  (data.refineries  ?? []).map(rs => Refinery.fromJSON(rs, scene, resources)),
                    oilWells:    (data.oilWells    ?? []).map(ws => OilWell.fromJSON(ws, scene, resources)),
                    powerPlants: (data.powerPlants ?? []).map(ps => PowerPlant.fromJSON(ps, scene, resources)),
                };
            }
        }
        // v4 save (no power plants)
        const raw4 = localStorage.getItem(V4_KEY);
        if (raw4) {
            const data = JSON.parse(raw4) as { version?: number; inventory?: Record<string, number>; camera?: ZoomSave; transports?: TransportSave[]; refineries?: RefinerySave[]; oilWells?: OilWellSave[] };
            if (data.version === 4) {
                const transports = _loadTransports(data.transports ?? [], scene, resources, homeNormal);
                const refineries = (data.refineries ?? []).map(rs => Refinery.fromJSON(rs, scene, resources));
                const oilWells   = (data.oilWells   ?? []).map(ws => OilWell.fromJSON(ws, scene, resources));
                _applyInventory(data.inventory ?? {}, resources);

                return { transports, refineries, oilWells, powerPlants: [] };
            }
        }
        // v3 save (no oil wells)
        const raw3 = localStorage.getItem(V3_KEY);
        if (raw3) {
            const data = JSON.parse(raw3) as { version?: number; inventory?: Record<string, number>; camera?: ZoomSave; transports?: TransportSave[]; refineries?: RefinerySave[] };
            if (data.version === 3) {
                const transports = _loadTransports(data.transports ?? [], scene, resources, homeNormal);
                const refineries = (data.refineries ?? []).map(rs => Refinery.fromJSON(rs, scene, resources));
                _applyInventory(data.inventory ?? {}, resources);

                return { transports, refineries, oilWells: [], powerPlants: [] };
            }
        }
        // v2 save (no refineries)
        const raw2 = localStorage.getItem(V2_KEY);
        if (raw2) {
            const data = JSON.parse(raw2) as { version?: number; inventory?: Record<string, number>; camera?: ZoomSave; transports?: TransportSave[] };
            if (data.version === 2) {
                const transports = _loadTransports(data.transports ?? [], scene, resources, homeNormal);
                _applyInventory(data.inventory ?? {}, resources);

                return { transports, refineries: [], oilWells: [], powerPlants: [] };
            }
        }
        // Legacy inventory-only
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
            _applyInventory(JSON.parse(legacy) as Record<string, number>, resources);
        }
    } catch { /* ignore malformed save */ }
    // No save / cleared data: inventory zero, deposits full, no trucks.
    for (const r of resources) {
        r.gathered = 0;
        r.deposit  = r.depositInitial;
    }
    return { transports: [], refineries: [], oilWells: [], powerPlants: [] };
}

function _applyV7(
    data:       GameSave,
    zoom:       ZoomController,
    resources:  Resource[],
    scene:      Scene,
    homeNormal: Vector3,
    techTree:   TechTree,
): { transports: Transport[]; refineries: Refinery[]; oilWells: OilWell[]; powerPlants: PowerPlant[] } {
    _applyInventory(data.inventory ?? {}, resources);
    _applyDeposits(data.deposits ?? {}, resources);

    for (const id of (data.techs ?? [])) techTree.research(id);
    const transports  = _loadTransports(data.transports ?? [], scene, resources, homeNormal);
    const refineries  = (data.refineries  ?? []).map(rs => Refinery.fromJSON(rs, scene, resources));
    const oilWells    = (data.oilWells    ?? []).map(ws => OilWell.fromJSON(ws, scene, resources));
    const powerPlants = (data.powerPlants ?? []).map(ps => PowerPlant.fromJSON(ps, scene, resources));
    return { transports, refineries, oilWells, powerPlants };
}

function _applyInventory(inv: Record<string, number>, resources: Resource[]): void {
    for (const r of resources) {
        const v = inv[r.name];
        if (typeof v === 'number') r.gathered = v;
    }
}

function _applyDeposits(dep: Record<string, number>, resources: Resource[]): void {
    for (const r of resources) {
        if (r.isManufactured) continue;
        const v = dep[r.name];
        if (typeof v === 'number') r.deposit = v;
    }
}

function _loadTransports(
    saves:      TransportSave[],
    scene:      Scene,
    resources:  Resource[],
    homeNormal: Vector3,
): Transport[] {
    const out: Transport[] = [];
    for (const td of saves) {
        if (td.type === 'TruckTransport') {
            out.push(TruckTransport.fromJSON(td, scene, resources, homeNormal));
        }
    }
    return out;
}
