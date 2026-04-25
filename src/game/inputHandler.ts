import {
    Raycaster, Vector2, Vector3, PerspectiveCamera, Mesh, Scene,
    MeshStandardMaterial, Sphere,
} from 'three';
import { R, SURFACE_RISE } from './constants';
import { Resource } from './resource';
import { Transport, resolveSourceNormal } from './transport';
import { Structure } from './structure';
import { Homebase } from './homebase';
import { ResourceNode } from './resourceNode';
import { Refinery } from './refinery';
import { OilWell } from './oilWell';
import { PowerPlant } from './powerPlant';
import { HUD } from './hud';
import { Flash } from './flash';

const TAP_SLOP_PX = 10;

const _worldPos = new Vector3();
const _UP       = new Vector3(0, 1, 0);

export class InputHandler {
    private raycaster    = new Raycaster();
    private pointer      = new Vector2();
    private earthSphere  = new Sphere(new Vector3(0, 0, 0), R);
    private touchStartX  = 0;
    private touchStartY  = 0;
    private lastCursorX  = 0;
    private lastCursorY  = 0;
    private selectedMesh:   Mesh | null = null;
    private savedSelColor:  number | null = null;

    private placementGhost:    Mesh | null = null;
    private placementRise      = 0;
    private placementCallback: ((normal: Vector3) => void) | null = null;
    private placementBanner:   HTMLElement;

    private structures: Structure[] = [];

    // Assign dialogue DOM (structure-tap → assign idle trucks)
    private assignOverlay!:    HTMLElement;
    private assignTitle!:      HTMLElement;
    private assignList!:       HTMLElement;
    private assignResPicker!:  HTMLElement;
    private assignBtn!:        HTMLButtonElement;
    private assignDeleteBtn!:  HTMLButtonElement;
    private assignSelected     = new Set<Transport>();
    private assignResources:   Resource[] = [];
    private assignStructure:   Structure | null = null;

    private deleteCallback: ((s: Structure) => void) | null = null;

    // Truck reassign dialogue DOM (truck-tap → change route)
    private truckOverlay!:    HTMLElement;
    private truckTitle!:      HTMLElement;
    private truckBody!:       HTMLElement;
    private truckTarget:      Transport | null = null;

    private saveCallback: () => void = () => {};

    constructor(
        private camera:     PerspectiveCamera,
        private scene:      Scene,
        private resources:  Resource[],
        private transports: Transport[],
        private hud:        HUD,
        private flash:      Flash,
        canvas:             HTMLCanvasElement,
        private onGather:   () => void = () => {},
        private showInfo:   (lines: string[]) => void = () => {},
    ) {
        this.placementBanner = this._makePlacementBanner();

        this.assignOverlay  = this._makeAssignOverlay();
        this.truckOverlay   = this._makeTruckReassignOverlay();

        canvas.addEventListener('touchstart', e => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
            this.lastCursorX = e.touches[0].clientX;
            this.lastCursorY = e.touches[0].clientY;
        }, { passive: true });

        canvas.addEventListener('touchmove', e => {
            this.lastCursorX = e.touches[0].clientX;
            this.lastCursorY = e.touches[0].clientY;
        }, { passive: true });

        canvas.addEventListener('touchend', e => {
            const t = e.changedTouches[0];
            const dx = t.clientX - this.touchStartX;
            const dy = t.clientY - this.touchStartY;
            if (Math.hypot(dx, dy) < TAP_SLOP_PX) {
                this.onTap(this.touchStartX, this.touchStartY);
            }
        }, { passive: true });

        canvas.addEventListener('mousemove', e => {
            this.lastCursorX = e.clientX;
            this.lastCursorY = e.clientY;
        });

        canvas.addEventListener('click', e => this.onTap(e.clientX, e.clientY));
    }

    setStructures(structures: Structure[]): void { this.structures = structures; }
    setSaveCallback(fn: () => void): void { this.saveCallback = fn; }
    setDeleteCallback(fn: (s: Structure) => void): void { this.deleteCallback = fn; }

    // ── Placement mode ────────────────────────────────────────────────────────

    startPlacement(ghost: Mesh, rise: number, callback: (normal: Vector3) => void): void {
        if (this.placementGhost) this._endPlacement();
        this.placementGhost    = ghost;
        this.placementRise     = rise;
        this.placementCallback = callback;
        this.scene.add(ghost);
        this.placementBanner.style.display = 'flex';
    }

    cancelPlacement(): void { this._endPlacement(); }

    private _endPlacement(): void {
        if (this.placementGhost) {
            this.scene.remove(this.placementGhost);
            this.placementGhost = null;
        }
        this.placementCallback = null;
        this.placementBanner.style.display = 'none';
    }

    // ── Per-frame update ──────────────────────────────────────────────────────

    update(): void {
        if (this.placementGhost) {
            const normal = this._getEarthNormal(this.lastCursorX, this.lastCursorY);
            if (normal) {
                this.placementGhost.position.copy(
                    normal.clone().multiplyScalar(R + this.placementRise),
                );
                this.placementGhost.quaternion.setFromUnitVectors(_UP, normal);
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private _getEarthNormal(cx: number, cy: number): Vector3 | null {
        this.pointer.set(
            (cx / window.innerWidth)  *  2 - 1,
            (cy / window.innerHeight) * -2 + 1,
        );
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit = new Vector3();
        if (!this.raycaster.ray.intersectSphere(this.earthSphere, hit)) return null;
        return hit.normalize();
    }

    private _select(mesh: Mesh | null): void {
        if (this.selectedMesh && this.savedSelColor !== null) {
            (this.selectedMesh.material as MeshStandardMaterial).color.setHex(this.savedSelColor);
        }
        this.selectedMesh = mesh;
        this.savedSelColor = null;
        if (!mesh) return;

        const mat = mesh.material as MeshStandardMaterial;
        this.savedSelColor = mat.color.getHex();
        mat.color.setHex(0xffffff);
    }

    private _truckCountFor(structure: Structure): number {
        const n = structure.surfaceNormal;
        if (structure instanceof Homebase) {
            return this.transports.filter(t => !t.stopped).length;
        }
        if (structure instanceof Refinery || structure instanceof PowerPlant) {
            return this.transports.filter(t => t.destinationNormal.dot(n) > 0.9999).length;
        }
        // ResourceNode / OilWell — count trucks routing to this specific node
        return this.transports.filter(
            t => t.sourceResource === structure.providesResource &&
                 t.srcNormal.dot(n) > 0.9999,
        ).length;
    }

    private onTap(cx: number, cy: number): void {
        if (this.placementCallback) {
            const normal = this._getEarthNormal(cx, cy);
            if (normal) {
                const cb = this.placementCallback;
                this._endPlacement();
                cb(normal);
            }
            return;
        }

        this.pointer.set(
            (cx / window.innerWidth)  *  2 - 1,
            (cy / window.innerHeight) * -2 + 1,
        );
        this.raycaster.setFromCamera(this.pointer, this.camera);

        // ── All structures (highest priority) ────────────────────────────────
        if (this.structures.length) {
            const structHits = this.raycaster.intersectObjects(
                this.structures.map(s => s.hitMesh),
            );
            if (structHits.length) {
                const structure = structHits[0].object.userData['structure'] as Structure;
                this._select(structure.mesh);
                const truckCount = this._truckCountFor(structure);
                this.showInfo(structure.getStatsLines(truckCount));

                if (structure instanceof Homebase) {
                    this.hud.showHomebase();
                    this._openAssignDialog('Homebase – Assign Transport',
                        this.resources.filter(r => r.hitMesh !== null),
                    );
                } else if (structure instanceof ResourceNode) {
                    const res = structure.providesResource!;
                    this.hud.showHomebase();
                    if (res.gather()) {
                        this.hud.update(res);
                        this.onGather();
                        if (res.mesh) {
                            res.mesh.scale.set(1.15, 2.0, 1.15);
                            setTimeout(() => res.mesh!.scale.set(1, 1, 1), 130);
                        }
                        this.flash.show(`+${res.gatherAmount} kg ${res.name}`, res.hex, cx, cy);
                    }
                } else if (structure instanceof Refinery) {
                    const inputNames = structure.inputResources.map(r => r.name);
                    this.hud.showContext(structure.label,
                        [...inputNames, structure.providesResource!.name],
                    );
                    this._openAssignDialog(
                        structure.label,
                        structure.inputResources,
                        structure,
                    );
                } else if (structure instanceof OilWell) {
                    this.hud.showHomebase();
                    this._openAssignDialog('Oil Well – Assign Transport',
                        [structure.providesResource!],
                        structure,
                    );
                } else if (structure instanceof PowerPlant) {
                    this.hud.showContext('Power Plant', [structure.fuelResource.name, 'Electricity']);
                    this._openAssignDialog(
                        `Power Plant – ${structure.fuelResource.name}`,
                        [structure.fuelResource],
                        structure,
                    );
                }
                return;
            }
        }

        // ── Trucks ────────────────────────────────────────────────────────────
        const truckHits = this.raycaster.intersectObjects(
            this.transports.map(t => t.hitMesh),
        );
        if (truckHits.length) {
            const transport = truckHits[0].object.userData['transport'] as Transport;
            this._select(transport.mesh);
            this.hud.showHomebase();
            this.showInfo(transport.getStatsLines());
            this._openTruckReassign(transport);
            return;
        }

        // ── Nothing hit ───────────────────────────────────────────────────────
        this._select(null);
        this.hud.showHomebase();
        this.showInfo([]);
    }

    // ── Assign dialogue ───────────────────────────────────────────────────────

    private _openAssignDialog(title: string, resources: Resource[], structure?: Structure): void {
        this.assignSelected.clear();
        this.assignResources = resources;
        this.assignStructure = structure ?? null;
        this.assignTitle.textContent = title;
        const deletable = structure instanceof Refinery || structure instanceof OilWell || structure instanceof PowerPlant;
        this.assignDeleteBtn.style.display = deletable ? 'block' : 'none';
        this._refreshAssignList();
        this._refreshAssignResPicker();
        this._refreshAssignBtn();
        this.assignOverlay.style.display = 'flex';
    }

    private _closeAssignDialog(): void {
        this.assignOverlay.style.display = 'none';
        this.assignSelected.clear();
        this.assignStructure = null;
    }

    private _refreshAssignList(): void {
        this.assignList.innerHTML = '';
        const idle = this.transports.filter(t => t.stopped);
        if (!idle.length) {
            const empty = document.createElement('div');
            Object.assign(empty.style, {
                fontSize: '12px', color: '#555', padding: '8px 0',
                fontFamily: '-apple-system, sans-serif',
            });
            empty.textContent = 'No idle transports';
            this.assignList.appendChild(empty);
            return;
        }
        for (const t of idle) {
            const row = document.createElement('button');
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 10px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '8px', cursor: 'pointer', width: '100%',
                color: '#ccc', fontFamily: '-apple-system, sans-serif',
                fontSize: '13px',
            });
            const check = document.createElement('span');
            check.textContent = '○';
            check.style.color = '#555';
            const label = document.createElement('span');
            label.textContent = `#${t.id} ${t.spec.name} (${t.sourceResource.name})`;
            label.style.flex = '1';
            row.append(check, label);

            row.addEventListener('click', () => {
                if (this.assignSelected.has(t)) {
                    this.assignSelected.delete(t);
                    check.textContent = '○';
                    check.style.color = '#555';
                    row.style.border = '1px solid rgba(255,255,255,0.07)';
                } else {
                    this.assignSelected.add(t);
                    check.textContent = '●';
                    check.style.color = '#f5a623';
                    row.style.border = '1px solid #f5a623';
                }
                this._refreshAssignBtn();
            });
            this.assignList.appendChild(row);
        }
    }

    private _refreshAssignResPicker(): void {
        this.assignResPicker.innerHTML = '';
        const label = document.createElement('div');
        Object.assign(label.style, {
            fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
            color: '#444', marginBottom: '6px',
            fontFamily: '-apple-system, sans-serif',
        });
        label.textContent = 'Collect resource';
        this.assignResPicker.appendChild(label);

        for (const res of this.assignResources) {
            const btn = document.createElement('button');
            Object.assign(btn.style, {
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 10px', marginBottom: '4px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px', cursor: 'pointer', width: '100%',
                color: '#ddd', fontFamily: '-apple-system, sans-serif',
                fontSize: '13px',
            });
            const swatch = document.createElement('span');
            Object.assign(swatch.style, {
                width: '12px', height: '12px', borderRadius: '3px',
                background: res.hex, flexShrink: '0',
            });
            const name = document.createElement('span');
            name.textContent = res.name;
            btn.append(swatch, name);
            // Enable only if some structure can OUTPUT this resource
            const hasProvider = this.structures.some(s => {
                const role = s.getResourceRole(res);
                return role === 'output' || role === 'both';
            });
            btn.disabled      = !hasProvider;
            btn.style.opacity = hasProvider ? '1' : '0.4';
            btn.addEventListener('click', () => {
                for (const t of this.assignSelected) {
                    if (this.assignStructure instanceof PowerPlant) {
                        // Route trucks physically to the power plant as delivery destination
                        t.reassignRoute(
                            this.assignStructure.surfaceNormal,
                            'Power Plant',
                            res,
                            this.structures,
                        );
                    } else {
                        t.reassign(res, this.structures);
                    }
                }
                this._closeAssignDialog();
                this.saveCallback();
            });
            this.assignResPicker.appendChild(btn);
        }
    }

    private _refreshAssignBtn(): void {
        const n = this.assignSelected.size;
        this.assignBtn.textContent  = n ? `Assign ${n} transport${n > 1 ? 's' : ''}` : 'Select transports above';
        this.assignBtn.disabled     = n === 0;
        this.assignBtn.style.opacity = n ? '1' : '0.4';
    }

    // ── DOM builders ──────────────────────────────────────────────────────────

    private _makePlacementBanner(): HTMLElement {
        const banner = document.createElement('div');
        Object.assign(banner.style, {
            position: 'fixed', bottom: '120px', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(10,10,20,0.92)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '12px', padding: '10px 20px',
            color: '#ccc', fontSize: '13px', fontFamily: '-apple-system, sans-serif',
            display: 'none', zIndex: '50', gap: '16px',
            alignItems: 'center', whiteSpace: 'nowrap',
        });
        const text = document.createElement('span');
        text.textContent = 'Tap the globe to place';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        Object.assign(cancelBtn.style, {
            background: 'none', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '6px', color: '#888', padding: '4px 10px',
            fontSize: '12px', cursor: 'pointer', fontFamily: '-apple-system, sans-serif',
        });
        cancelBtn.addEventListener('click', () => this.cancelPlacement());
        banner.append(text, cancelBtn);
        document.body.appendChild(banner);
        return banner;
    }

    private _makeAssignOverlay(): HTMLElement {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '40',
            display: 'none', alignItems: 'center', justifyContent: 'center',
        });

        const backdrop = document.createElement('div');
        Object.assign(backdrop.style, {
            position: 'absolute', inset: '0', background: 'rgba(0,0,0,0.6)',
        });
        backdrop.addEventListener('click', () => this._closeAssignDialog());

        const card = document.createElement('div');
        Object.assign(card.style, {
            position: 'relative', zIndex: '1',
            background: 'rgba(14,14,20,0.98)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px', padding: '20px',
            width: 'min(340px, 92vw)', maxHeight: '80vh',
            overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '12px',
            fontFamily: '-apple-system, sans-serif',
        });

        const headerRow = document.createElement('div');
        Object.assign(headerRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
        this.assignTitle = document.createElement('div');
        Object.assign(this.assignTitle.style, {
            fontSize: '11px', fontWeight: '600', letterSpacing: '1.5px',
            textTransform: 'uppercase', color: '#666',
        });
        const closeX = document.createElement('button');
        closeX.textContent = '✕';
        Object.assign(closeX.style, {
            background: 'none', border: 'none', color: '#555',
            fontSize: '18px', cursor: 'pointer', padding: '4px',
        });
        closeX.addEventListener('click', () => this._closeAssignDialog());
        headerRow.append(this.assignTitle, closeX);

        const listLabel = document.createElement('div');
        Object.assign(listLabel.style, {
            fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#444',
        });
        listLabel.textContent = 'Idle Transports';

        this.assignList = document.createElement('div');
        Object.assign(this.assignList.style, { display: 'flex', flexDirection: 'column', gap: '4px' });

        this.assignResPicker = document.createElement('div');
        Object.assign(this.assignResPicker.style, { display: 'flex', flexDirection: 'column' });

        this.assignBtn = document.createElement('button');
        Object.assign(this.assignBtn.style, {
            padding: '10px', background: 'rgba(245,166,35,0.15)',
            border: '1px solid rgba(245,166,35,0.4)',
            borderRadius: '10px', color: '#f5a623',
            fontSize: '13px', cursor: 'pointer',
        });
        this.assignBtn.textContent = 'Select transports above';
        this.assignBtn.disabled = true;
        this.assignBtn.style.opacity = '0.4';

        this.assignDeleteBtn = document.createElement('button');
        Object.assign(this.assignDeleteBtn.style, {
            padding: '10px', background: 'rgba(220,53,69,0.12)',
            border: '1px solid rgba(220,53,69,0.35)',
            borderRadius: '10px', color: '#e05060',
            fontSize: '13px', cursor: 'pointer', display: 'none',
        });
        this.assignDeleteBtn.textContent = 'Delete Structure';
        this.assignDeleteBtn.addEventListener('click', () => {
            const s = this.assignStructure;
            if (!s || !this.deleteCallback) return;
            this._select(null);
            this._closeAssignDialog();
            this.deleteCallback(s);
        });

        card.append(headerRow, listLabel, this.assignList, this.assignResPicker, this.assignBtn, this.assignDeleteBtn);
        overlay.append(backdrop, card);
        document.body.appendChild(overlay);
        return overlay;
    }

    // ── Truck reassign dialogue ───────────────────────────────────────────────

    private _openTruckReassign(transport: Transport): void {
        this.truckTarget = transport;
        this.truckTitle.textContent = `${transport.spec.name} #${transport.id}`;
        this._showDestStep();
        this.truckOverlay.style.display = 'flex';
    }

    private _closeTruckReassign(): void {
        this.truckOverlay.style.display = 'none';
        this.truckTarget = null;
    }

    private _showDestStep(): void {
        this.truckBody.innerHTML = '';
        this.truckBody.appendChild(this._sectionLabel('DELIVER TO'));

        for (const s of this.structures) {
            // Any structure that accepts at least one resource is a valid delivery destination
            const acceptsAny = this.resources.some(r => {
                const role = s.getResourceRole(r);
                return role === 'input' || role === 'both';
            });
            if (!acceptsAny) continue;
            const name   = s.label;
            const normal = s.surfaceNormal.clone();
            const btn    = this._rowButton(name, '');
            btn.addEventListener('click', () => this._showResourceStep(normal, name));
            this.truckBody.appendChild(btn);
        }
    }

    private _showResourceStep(destNormal: Vector3, destName: string): void {
        if (!this.truckTarget) return;
        this.truckBody.innerHTML = '';

        const backBtn = document.createElement('button');
        backBtn.textContent = '← Back';
        Object.assign(backBtn.style, {
            background: 'none', border: 'none', color: '#555',
            fontSize: '12px', cursor: 'pointer', padding: '0 0 8px 0',
            fontFamily: '-apple-system, sans-serif', textAlign: 'left',
        });
        backBtn.addEventListener('click', () => this._showDestStep());
        this.truckBody.appendChild(backBtn);

        this.truckBody.appendChild(this._sectionLabel(`PICK UP RESOURCE → ${destName}`));

        // Show resources that have at least one dedicated output source (not 'both'/Homebase)
        const available = this.resources.filter(r =>
            this.structures.some(s => s.getResourceRole(r) === 'output'),
        );

        for (const res of available) {
            const sourceNormal = resolveSourceNormal(res, this.structures, destNormal);
            const distKm = (Math.acos(Math.min(1, Math.max(-1, destNormal.dot(sourceNormal)))) * 6_371_000 / 1000).toFixed(1);
            const btn = this._rowButton(res.name, `${distKm} km from ${destName}`, res.hex);
            btn.addEventListener('click', () => {
                this.truckTarget!.reassignRoute(destNormal, destName, res, this.structures);
                this.saveCallback();
                this._closeTruckReassign();
            });
            this.truckBody.appendChild(btn);
        }
    }

    private _sectionLabel(text: string): HTMLElement {
        const el = document.createElement('div');
        Object.assign(el.style, {
            fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
            color: '#444', marginBottom: '6px', fontFamily: '-apple-system, sans-serif',
        });
        el.textContent = text;
        return el;
    }

    private _rowButton(label: string, sub: string, swatchColor?: string): HTMLElement {
        const btn = document.createElement('button');
        Object.assign(btn.style, {
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 10px', marginBottom: '4px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px', cursor: 'pointer', width: '100%',
            color: '#ddd', fontFamily: '-apple-system, sans-serif', fontSize: '13px',
        });
        if (swatchColor) {
            const swatch = document.createElement('span');
            Object.assign(swatch.style, {
                width: '10px', height: '10px', borderRadius: '2px',
                background: swatchColor, flexShrink: '0',
            });
            btn.appendChild(swatch);
        }
        const nameEl = document.createElement('span');
        nameEl.textContent = label;
        nameEl.style.flex = '1';
        btn.appendChild(nameEl);
        if (sub) {
            const subEl = document.createElement('span');
            subEl.textContent = sub;
            Object.assign(subEl.style, { fontSize: '10px', color: '#555' });
            btn.appendChild(subEl);
        }
        return btn;
    }

    private _makeTruckReassignOverlay(): HTMLElement {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '45',
            display: 'none', alignItems: 'center', justifyContent: 'center',
        });

        const backdrop = document.createElement('div');
        Object.assign(backdrop.style, {
            position: 'absolute', inset: '0', background: 'rgba(0,0,0,0.6)',
        });
        backdrop.addEventListener('click', () => this._closeTruckReassign());

        const card = document.createElement('div');
        Object.assign(card.style, {
            position: 'relative', zIndex: '1',
            background: 'rgba(14,14,20,0.98)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px', padding: '20px',
            width: 'min(320px, 92vw)', maxHeight: '70vh',
            overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '8px',
            fontFamily: '-apple-system, sans-serif',
        });

        const headerRow = document.createElement('div');
        Object.assign(headerRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' });

        this.truckTitle = document.createElement('div');
        Object.assign(this.truckTitle.style, {
            fontSize: '11px', fontWeight: '600', letterSpacing: '1.5px',
            textTransform: 'uppercase', color: '#666',
        });

        const closeX = document.createElement('button');
        closeX.textContent = '✕';
        Object.assign(closeX.style, {
            background: 'none', border: 'none', color: '#555',
            fontSize: '18px', cursor: 'pointer', padding: '4px',
        });
        closeX.addEventListener('click', () => this._closeTruckReassign());
        headerRow.append(this.truckTitle, closeX);

        this.truckBody = document.createElement('div');
        Object.assign(this.truckBody.style, { display: 'flex', flexDirection: 'column' });

        card.append(headerRow, this.truckBody);
        overlay.append(backdrop, card);
        document.body.appendChild(overlay);
        return overlay;
    }
}
