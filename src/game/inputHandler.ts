import {
    Raycaster, Vector2, Vector3, PerspectiveCamera, Mesh, Scene, Sphere,
    EdgesGeometry, LineSegments, LineBasicMaterial, LineDashedMaterial,
    Line, BufferGeometry, Float32BufferAttribute,
    Material, MeshBasicMaterial, DoubleSide,
} from 'three';
import { R, SURFACE_RISE, SAME_NORMAL_DOT } from './constants';
import { Resource, formatScaled } from './resource';
import { Transport, TruckTransport, resolveSourceNormal } from './transport';
import { Structure } from './structure';
import { Homebase } from './homebase';
import { ResourceNode } from './resourceNode';
import { Refinery } from './refinery';
import { OilWell } from './oilWell';
import { PowerPlant } from './powerPlant';
import { HUD } from './hud';
import { Flash, splitTwoLines } from './flash';
import { Tooltip, buildTooltipBody, TooltipRow } from './tooltip';

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
    private outlineLines:   LineSegments | null = null;
    private pathLine:       Line | null = null;

    private placementGhost:    Mesh | null = null;
    private placementRise      = 0;
    private placementCallback: ((normal: Vector3) => void) | null = null;
    private placementValidator: ((normal: Vector3) => boolean) | null = null;
    private placementOriginalMaterial: Material | Material[] | null = null;
    private placementInvalidMaterial:  Material | null = null;
    private placementValid     = true;
    private placementInvalidMessage = '';
    private notifyCallback: ((msg: string) => void) | null = null;
    private placementBanner:   HTMLElement;

    private tooltip:           Tooltip;
    private tooltipRafPending  = false;

    // Cursor lat/lon readout (rendered by debug HUD owner via setCursorInfo)
    private cursorLat: number | null = null;
    private cursorLon: number | null = null;
    private setCursorInfo: (text: string) => void = () => {};
    private _cursorReadoutEnabled = false;

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
    private buildTruckCallback: ((destNormal: Vector3, destName: string, resource: Resource) => boolean) | null = null;

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
        this.tooltip         = new Tooltip();

        this.assignOverlay  = this._makeAssignOverlay();
        this.truckOverlay   = this._makeTruckReassignOverlay();

        window.addEventListener('keydown', e => {
            if (e.key === 'p' || e.key === 'P') this._copyCursorLatLon();
        });

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

        // Track cursor on window so coords stay fresh even when pointer is over
        // overlay DOM (homebase icon, debug HUD, time controls, etc.).
        window.addEventListener('mousemove', e => {
            this.lastCursorX = e.clientX;
            this.lastCursorY = e.clientY;
            this._scheduleTooltipUpdate(e.target as Element | null);
        });

        canvas.addEventListener('click', e => this.onTap(e.clientX, e.clientY));
    }

    setStructures(structures: Structure[]): void { this.structures = structures; }
    setSaveCallback(fn: () => void): void { this.saveCallback = fn; }
    setBuildTruckCallback(fn: (destNormal: Vector3, destName: string, resource: Resource) => boolean): void {
        this.buildTruckCallback = fn;
    }
    setDeleteCallback(fn: (s: Structure) => void): void { this.deleteCallback = fn; }

    // ── Placement mode ────────────────────────────────────────────────────────

    setNotifyCallback(fn: (msg: string) => void): void { this.notifyCallback = fn; }

    startPlacement(
        ghost: Mesh,
        rise: number,
        callback: (normal: Vector3) => void,
        validator?: (normal: Vector3) => boolean,
        invalidMessage = '',
    ): void {
        if (this.placementGhost) this._endPlacement();
        this.placementGhost    = ghost;
        this.placementRise     = rise;
        this.placementCallback = callback;
        this.placementValidator = validator ?? null;
        this.placementInvalidMessage = invalidMessage;
        this.placementOriginalMaterial = ghost.material as Material | Material[];
        // Red translucent material — same geometry, just tinted red at 50% opacity.
        // Use MeshStandardMaterial so lighting matches the original ghost.
        // Unlit so the red color isn't attenuated by scene lighting.
        // DoubleSide + renderOrder so the translucent box draws over the Earth.
        this.placementInvalidMaterial = new MeshBasicMaterial({
            color: 0xff2222,
            transparent: true,
            opacity: 0.25,
            side: DoubleSide,
            depthWrite: false,
        });
        this.placementValid = true;
        this.scene.add(ghost);
        this.placementBanner.style.display = 'flex';
    }

    cancelPlacement(): void { this._endPlacement(); }

    private _endPlacement(): void {
        if (this.placementGhost && this.placementOriginalMaterial) {
            this.placementGhost.material = this.placementOriginalMaterial;
        }
        if (this.placementInvalidMaterial) {
            this.placementInvalidMaterial.dispose();
            this.placementInvalidMaterial = null;
        }
        if (this.placementGhost) {
            this.scene.remove(this.placementGhost);
            this.placementGhost = null;
        }
        this.placementCallback         = null;
        this.placementValidator        = null;
        this.placementOriginalMaterial = null;
        this.placementValid            = true;
        this.placementBanner.style.display = 'none';
    }

    // ── Per-frame update ──────────────────────────────────────────────────────

    update(): void {
        // Cheap path: when neither placement nor cursor readout is active, skip
        // the raycast and trig entirely. Keeps overhead at zero in normal play.
        if (!this.placementGhost && !this._cursorReadoutEnabled) return;

        const normal = this._getEarthNormal(this.lastCursorX, this.lastCursorY);

        if (this.placementGhost && normal) {
            this.placementGhost.position.copy(
                normal.clone().multiplyScalar(R + this.placementRise),
            );
            this.placementGhost.quaternion.setFromUnitVectors(_UP, normal);

            // Validator: tint red+translucent if placement invalid.
            const valid = this.placementValidator ? this.placementValidator(normal) : true;
            if (valid !== this.placementValid) {
                this.placementValid = valid;
                this.placementGhost.material = valid
                    ? this.placementOriginalMaterial!
                    : this.placementInvalidMaterial!;
                // Draw invalid ghost after opaque scene so the translucent red shows up.
                this.placementGhost.renderOrder = valid ? 0 : 10;
            }
        }

        if (!this._cursorReadoutEnabled) return;

        if (normal) {
            // Invert the lat/lon → unit-normal mapping from world.ts:
            //   X = cos(lat)·cos(lon), Y = sin(lat), Z = -cos(lat)·sin(lon)
            this.cursorLat = Math.asin(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;
            this.cursorLon = Math.atan2(-normal.z, normal.x) * 180 / Math.PI;
            this.setCursorInfo(
                `cursor ${this.cursorLat.toFixed(4)}, ${this.cursorLon.toFixed(4)} (P)`,
            );
        } else {
            this.cursorLat = null;
            this.cursorLon = null;
            this.setCursorInfo('');
        }
    }

    setCursorInfoCallback(fn: (text: string) => void): void { this.setCursorInfo = fn; }
    setCursorReadoutEnabled(enabled: boolean): void {
        this._cursorReadoutEnabled = enabled;
        if (!enabled) { this.setCursorInfo(''); this.cursorLat = null; this.cursorLon = null; }
    }

    private _copyCursorLatLon(): void {
        // Recompute from latest cursor — don't rely on per-frame cache, in case
        // update() hasn't ticked since the last mousemove.
        const normal = this._getEarthNormal(this.lastCursorX, this.lastCursorY);
        if (!normal) return;
        this.cursorLat = Math.asin(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;
        this.cursorLon = Math.atan2(-normal.z, normal.x) * 180 / Math.PI;
        const text = `${this.cursorLat.toFixed(6)}, ${this.cursorLon.toFixed(6)}`;
        const flash = (msg: string) => {
            this.setCursorInfo(msg);
            setTimeout(() => {
                if (this.cursorLat !== null && this.cursorLon !== null) {
                    this.setCursorInfo(
                        `cursor ${this.cursorLat.toFixed(4)}, ${this.cursorLon.toFixed(4)} (P)`,
                    );
                }
            }, 900);
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => { flash(`copied ${text}`); alert(`Copied to clipboard:\n${text}`); })
                .catch(() => { flash(`copy fail ${text}`); alert(`Copy failed:\n${text}`); });
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch { /* ignore */ }
            document.body.removeChild(ta);
            if (ok) { flash(`copied ${text}`); alert(`Copied to clipboard:\n${text}`); }
            else    { flash(`copy fail ${text}`); alert(`Copy failed:\n${text}`); }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    // ── Hover tooltip ─────────────────────────────────────────────────────────

    private _scheduleTooltipUpdate(target: Element | null): void {
        // Skip raycast while a UI overlay is interacting (pointer over button/dialog).
        // The canvas underlies overlays — bail when cursor is not on canvas/body.
        const onCanvas = !target || target === document.body || (target as HTMLElement).tagName === 'CANVAS';
        if (!onCanvas) { this.tooltip.hide(); return; }
        if (this.placementGhost) { this.tooltip.hide(); return; }
        if (this.tooltipRafPending) return;
        this.tooltipRafPending = true;
        requestAnimationFrame(() => {
            this.tooltipRafPending = false;
            this._updateTooltip(this.lastCursorX, this.lastCursorY);
        });
    }

    // Re-run tooltip content build without moving the cursor — call when underlying
    // data (inventory / deposit) changes so visible values stay live.
    refreshTooltip(): void {
        if (!this.tooltip.isVisible) return;
        this._updateTooltip(this.lastCursorX, this.lastCursorY);
    }

    private _lastAssignDigest = '';

    // Re-render assign dialog buttons so iron-cost / source-state badges stay live.
    // Only fires when underlying state actually changed — preserves hover tooltips.
    refreshAssignDialog(): void {
        if (this.assignOverlay.style.display !== 'flex') return;
        const iron = this.resources.find(r => r.name === 'Iron');
        const ironHave = iron ? iron.gathered : 0;
        const idleCount = this.transports.filter(t => t.stopped).length;
        const depBits = this.assignResources.map(r => {
            const has = this.structures.some(s => {
                const role = s.getResourceRole(r); return role === 'output' || role === 'both';
            }) ? 1 : 0;
            const assigned = this.assignStructure
                ? this.transports.filter(t =>
                    t.sourceResource === r &&
                    t.destinationNormal.dot(this.assignStructure!.surfaceNormal) > SAME_NORMAL_DOT,
                ).length
                : 0;
            return `${r.name}:${r.deposit | 0}:${has}:${assigned}`;
        }).join('|');
        const digest = `${ironHave | 0}|${idleCount}|${depBits}`;
        if (digest === this._lastAssignDigest) return;
        this._lastAssignDigest = digest;
        this._refreshAssignResPicker();
        this._refreshAssignList();
    }

    private _updateTooltip(cx: number, cy: number): void {
        if (!this.structures.length) { this.tooltip.hide(); return; }
        this.pointer.set(
            (cx / window.innerWidth)  *  2 - 1,
            (cy / window.innerHeight) * -2 + 1,
        );
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(
            this.structures.map(s => s.hitMesh),
        );
        if (!hits.length) { this.tooltip.hide(); return; }
        const s = hits[0].object.userData['structure'] as Structure | undefined;
        if (!s) { this.tooltip.hide(); return; }
        const body = buildTooltipBody(s.label, this._typeOf(s), this._inventoryRows(s));
        this.tooltip.setContent(body);
        this.tooltip.show(cx, cy);
    }

    private _typeOf(s: Structure): string {
        if (s instanceof Homebase)     return 'Homebase';
        if (s instanceof ResourceNode) return 'Resource Deposit';
        if (s instanceof Refinery)     return 'Refinery';
        if (s instanceof OilWell)      return 'Oil Well';
        if (s instanceof PowerPlant)   return 'Power Plant';
        return 'Structure';
    }

    private _inventoryRows(s: Structure): TooltipRow[] {
        const row = (r: Resource): TooltipRow => ({
            label:  r.name,
            value:  r.displayAmount,
            swatch: r.hex,
        });
        const depositRow = (r: Resource): TooltipRow => ({
            label:  r.name,
            value:  `${formatScaled(r.deposit, r.unit)} remaining`,
            swatch: r.hex,
        });
        if (s instanceof Homebase) {
            return this.resources.map(row);
        }
        if (s instanceof ResourceNode || s instanceof OilWell) {
            return [depositRow(s.providesResource!)];
        }
        if (s instanceof Refinery) {
            const rows = s.inputResources.map(row);
            if (s.providesResource) rows.push(row(s.providesResource));
            return rows;
        }
        if (s instanceof PowerPlant) {
            return [row(s.fuelResource), row(s.providesResource)];
        }
        return [];
    }

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

    private _select(mesh: Mesh | null, transport?: Transport): void {
        // Clear prior outline + path
        if (this.outlineLines) {
            this.outlineLines.parent?.remove(this.outlineLines);
            this.outlineLines.geometry.dispose();
            (this.outlineLines.material as LineBasicMaterial).dispose();
            this.outlineLines = null;
        }
        if (this.pathLine) {
            this.pathLine.parent?.remove(this.pathLine);
            this.pathLine.geometry.dispose();
            (this.pathLine.material as LineDashedMaterial).dispose();
            this.pathLine = null;
        }
        this.selectedMesh = mesh;
        if (!mesh) return;

        const edges = new EdgesGeometry(mesh.geometry as BufferGeometry);
        const outline = new LineSegments(edges, new LineBasicMaterial({
            color: 0xff2222, depthTest: false, transparent: true,
        }));
        outline.renderOrder = 999;
        mesh.add(outline);
        this.outlineLines = outline;

        if (transport) {
            this.pathLine = this._buildTruckPath(transport);
            this.scene.add(this.pathLine);
        }
    }

    private _buildTruckPath(t: Transport): Line {
        const a = t.srcNormal.clone().normalize();
        const b = t.destinationNormal.clone().normalize();
        const theta  = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
        const radius = R + SURFACE_RISE + 5;
        const N = 64;
        const pts: number[] = [];
        for (let i = 0; i <= N; i++) {
            const u = i / N;
            let p: Vector3;
            if (theta < 1e-6) {
                p = a.clone().lerp(b, u);
            } else {
                const w1 = Math.sin((1 - u) * theta) / Math.sin(theta);
                const w2 = Math.sin(u * theta)       / Math.sin(theta);
                p = a.clone().multiplyScalar(w1).addScaledVector(b, w2);
            }
            p.normalize().multiplyScalar(radius);
            pts.push(p.x, p.y, p.z);
        }
        const geom = new BufferGeometry();
        geom.setAttribute('position', new Float32BufferAttribute(pts, 3));
        const arcLen  = Math.max(theta * R, 1);
        const dashLen = arcLen / 40;
        const line = new Line(geom, new LineDashedMaterial({
            color:    0xffffff,
            dashSize: dashLen,
            gapSize:  dashLen,
            depthTest:   false,
            transparent: true,
        }));
        line.computeLineDistances();
        line.renderOrder = 998;
        return line;
    }

    private _truckCountFor(structure: Structure): number {
        const n = structure.surfaceNormal;
        if (structure instanceof Homebase) {
            return this.transports.filter(t => !t.stopped).length;
        }
        if (structure instanceof Refinery || structure instanceof PowerPlant) {
            return this.transports.filter(t => t.destinationNormal.dot(n) > SAME_NORMAL_DOT).length;
        }
        // ResourceNode / OilWell — count trucks routing to this specific node
        return this.transports.filter(
            t => t.sourceResource === structure.providesResource &&
                 t.srcNormal.dot(n) > SAME_NORMAL_DOT,
        ).length;
    }

    private onTap(cx: number, cy: number): void {
        if (this.placementCallback) {
            const normal = this._getEarthNormal(cx, cy);
            if (normal) {
                if (this.placementValidator && !this.placementValidator(normal)) {
                    if (this.placementInvalidMessage && this.placementGhost) {
                        const v = new Vector3();
                        this.placementGhost.getWorldPosition(v);
                        v.project(this.camera);
                        const sx = (v.x + 1) / 2 * window.innerWidth;
                        const sy = (1 - v.y) / 2 * window.innerHeight;
                        this.flash.show(splitTwoLines(this.placementInvalidMessage), '#ff5555', sx, sy, 5000);
                    }
                    return;
                }
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
                        structure,
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
                        this.flash.show(`+${formatScaled(res.gatherAmount, 'kg')} ${res.name}`, res.hex, cx, cy);
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
            this._select(transport.mesh, transport);
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
        this._lastAssignDigest = '';
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

        const iron = this.resources.find(r => r.name === 'Iron');
        const canAffordTruck = !!iron && iron.gathered >= TruckTransport.IRON_COST;

        for (const res of this.assignResources) {
            const row = document.createElement('div');
            Object.assign(row.style, { display: 'flex', gap: '4px', marginBottom: '4px' });

            const btn = document.createElement('button');
            Object.assign(btn.style, {
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 10px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px', cursor: 'pointer', flex: '1',
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
            Object.assign(name.style, { flex: '1' });
            btn.append(swatch, name);

            // Truck count: trucks currently routed to deliver this resource to assignStructure.
            const assignedCount = this.assignStructure
                ? this.transports.filter(t =>
                    t.sourceResource === res &&
                    t.destinationNormal.dot(this.assignStructure!.surfaceNormal) > SAME_NORMAL_DOT,
                ).length
                : 0;
            if (assignedCount > 0) {
                const badge = document.createElement('span');
                badge.textContent = `${assignedCount} 🚚`;
                Object.assign(badge.style, {
                    fontSize: '11px', color: '#aaa',
                    background: 'rgba(255,255,255,0.08)',
                    borderRadius: '6px', padding: '2px 6px',
                });
                btn.append(badge);
            }

            const hasProvider = this.structures.some(s => {
                const role = s.getResourceRole(res);
                return role === 'output' || role === 'both';
            });
            // Natural resources (single global deposit) — flag depleted.
            const depleted = hasProvider && !res.isManufactured && res.deposit <= 0;
            const noSource = !hasProvider || depleted;

            btn.disabled      = noSource;
            btn.style.opacity = noSource ? '0.45' : '1';
            if (noSource) {
                btn.style.border  = '1px solid rgba(255,80,80,0.65)';
                btn.style.color   = '#ff7676';
                btn.style.background = 'rgba(255,80,80,0.10)';
                btn.title = !hasProvider ? 'No source available' : 'Deposit depleted';
                const warn = document.createElement('span');
                warn.textContent = !hasProvider ? '⚠ no source' : '⚠ depleted';
                Object.assign(warn.style, { marginLeft: 'auto', fontSize: '11px', color: '#ff7676' });
                btn.appendChild(warn);
            }
            btn.addEventListener('click', () => {
                for (const t of this.assignSelected) {
                    if (this.assignStructure instanceof PowerPlant) {
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
            row.appendChild(btn);

            // "+ Truck" — build a new truck for this resource, dest = tapped structure.
            const buildBtn = document.createElement('button');
            const buildOk  = !noSource && canAffordTruck && !!this.assignStructure;
            Object.assign(buildBtn.style, {
                padding: '8px 10px',
                background: 'rgba(143,188,143,0.10)',
                border: '1px solid rgba(143,188,143,0.4)',
                borderRadius: '8px', cursor: 'pointer',
                color: '#8fbc8f', fontFamily: '-apple-system, sans-serif',
                fontSize: '12px', whiteSpace: 'nowrap',
                pointerEvents: 'auto',  // ensure hover/title fires even when disabled
            });
            const costLabel = formatScaled(TruckTransport.IRON_COST, 'kg');
            const ironHave  = iron ? iron.gathered : 0;
            let reason = '';
            let shortReason = '';
            if (!this.assignStructure)            { reason = 'No destination structure';                                             shortReason = 'No dest'; }
            else if (!hasProvider)                { reason = `No structure produces ${res.name}`;                                    shortReason = 'No source'; }
            else if (depleted)                    { reason = `${res.name} deposit depleted`;                                         shortReason = 'Depleted'; }
            else if (!canAffordTruck)             { reason = `Need ${costLabel} Iron (have ${formatScaled(ironHave, 'kg')})`;        shortReason = `Need ${costLabel}`; }
            buildBtn.textContent      = buildOk ? '+ Truck' : shortReason;
            buildBtn.title            = buildOk
                ? `Build new truck (cost ${costLabel} Iron) → ${this.assignStructure?.label ?? ''}`
                : reason;
            buildBtn.disabled         = !buildOk;
            buildBtn.style.opacity    = buildOk ? '1' : '0.55';
            buildBtn.style.color      = buildOk ? '#8fbc8f' : '#ff7676';
            buildBtn.style.borderColor = buildOk ? 'rgba(143,188,143,0.4)' : 'rgba(255,80,80,0.5)';
            buildBtn.addEventListener('click', () => {
                if (!this.assignStructure || !this.buildTruckCallback) return;
                const destNormal = this.assignStructure.surfaceNormal;
                const destName   = this.assignStructure instanceof PowerPlant
                    ? 'Power Plant'
                    : this.assignStructure.label;
                const built = this.buildTruckCallback(destNormal, destName, res);
                if (built) {
                    this._closeAssignDialog();
                    this.saveCallback();
                }
            });
            row.appendChild(buildBtn);

            this.assignResPicker.appendChild(row);
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
