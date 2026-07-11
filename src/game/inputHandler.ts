import {
    Raycaster, Vector2, Vector3, PerspectiveCamera, Mesh, Scene, Sphere,
    EdgesGeometry, LineSegments, LineBasicMaterial, LineDashedMaterial,
    Line, BufferGeometry, Float32BufferAttribute,
    Material, MeshBasicMaterial, DoubleSide,
} from 'three';
import { R, SURFACE_RISE } from './constants';
import { isSameStructureNormal, normalToLatLon, clampDot } from './geo';
import { Resource, formatScaled } from './resource';
import { Transport, resolveSource } from './transport';
import { Structure } from './structure';
import { Homebase } from './homebase';
import { ResourceNode } from './resourceNode';
import { Refinery } from './refinery';
import { OilWell } from './oilWell';
import { PowerPlant } from './powerPlant';
import { HUD } from './hud';
import { Flash, splitTwoLines } from './flash';
import { Tooltip, buildStructureTooltip, TooltipRow, TooltipSection, CraftInfo } from './tooltip';

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

    // Request dialogue DOM (structure-tap → create a transport request)
    private requestOverlay!:   HTMLElement;
    private requestTitle!:     HTMLElement;
    private requestBody!:      HTMLElement;
    private requestDeleteBtn!: HTMLButtonElement;
    private requestStructure:  Structure | null = null;

    private deleteCallback: ((s: Structure) => void) | null = null;

    private saveCallback: () => void = () => {};
    // Manual tap-to-gather, routed through the engine. Returns false if depleted.
    // Default is a no-op (gathering is inert until wired to the engine) so there
    // is no code path that mutates inventory outside the engine.
    private gatherCallback: (res: Resource) => boolean = () => false;
    // Create a transport request: haul `qty` kg of `resource` to the structure at `destNormal`.
    private createRequestCallback:
        ((destNormal: Vector3, destName: string, resource: Resource, qty: number) => void) | null = null;

    // Preset order sizes (kg) offered in the quantity step.
    private static readonly QTY_PRESETS = [20_000, 100_000, 500_000, 2_000_000];

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

        this.requestOverlay = this._makeRequestOverlay();

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
    setGatherCallback(fn: (res: Resource) => boolean): void { this.gatherCallback = fn; }
    setCreateRequestCallback(
        fn: (destNormal: Vector3, destName: string, resource: Resource, qty: number) => void,
    ): void {
        this.createRequestCallback = fn;
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
            const ll = normalToLatLon(normal);
            this.cursorLat = ll.lat;
            this.cursorLon = ll.lon;
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
        const ll = normalToLatLon(normal);
        this.cursorLat = ll.lat;
        this.cursorLon = ll.lon;
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
        const { sections, craft } = this._tooltipContent(s);
        this.tooltip.setContent(buildStructureTooltip(s.label, this._typeOf(s), sections, craft));
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

    // Build the hover content for a structure: labelled Input/Output sections
    // (plus a stockpile/deposit view for storage and raw nodes) and, for crafting
    // structures, the crafting time + live progress.
    private _tooltipContent(s: Structure): { sections: TooltipSection[]; craft?: CraftInfo } {
        const inv = (r: Resource): TooltipRow => ({ label: r.name, value: r.displayAmount, swatch: r.hex });
        const dep = (r: Resource): TooltipRow => ({ label: r.name, value: `${formatScaled(r.deposit, r.unit)} remaining`, swatch: r.hex });
        // A producer's output row shows what's currently on hand at the structure
        // for pickup (the pickup buffer), NOT the player's total lifetime stock.
        const out = (r: Resource): TooltipRow => ({ label: r.name, value: `${formatScaled(r.deposit, r.unit)} available`, swatch: r.hex });

        if (s instanceof Homebase) {
            return { sections: [{ label: 'Stockpile', rows: this.resources.map(inv) }] };
        }
        if (s instanceof ResourceNode || s instanceof OilWell) {
            return { sections: [{ label: 'Output', rows: [dep(s.providesResource!)] }] };
        }
        if (s instanceof Refinery) {
            return {
                sections: [
                    { label: 'Inputs', rows: s.inputResources.map(inv) },
                    { label: 'Output', rows: [out(s.providesResource)] },
                ],
                craft: { seconds: s.craftSeconds, progress01: s.craftProgress01() ?? 0 },
            };
        }
        if (s instanceof PowerPlant) {
            return {
                sections: [
                    { label: 'Input',  rows: [inv(s.fuelResource)] },
                    { label: 'Output', rows: [out(s.providesResource)] },
                ],
                craft: { seconds: s.craftSeconds, progress01: s.craftProgress01() ?? 0 },
            };
        }
        return { sections: [] };
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
        const theta  = Math.acos(clampDot(a.dot(b)));
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
        // Active trucks currently loading at or delivering to this structure.
        return this.transports.filter(t =>
            !t.isIdle && (isSameStructureNormal(t.destinationNormal, n) ||
                          isSameStructureNormal(t.srcNormal, n)),
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

                if (structure instanceof ResourceNode) {
                    // Source pad — manual gather on tap (no delivery destination here).
                    const res = structure.providesResource!;
                    this.hud.showHomebase();
                    if (this.gatherCallback(res)) {
                        this.hud.update(res);
                        this.onGather();
                        if (res.mesh) {
                            res.mesh.scale.set(1.15, 2.0, 1.15);
                            setTimeout(() => res.mesh!.scale.set(1, 1, 1), 130);
                        }
                        this.flash.show(`+${formatScaled(res.gatherAmount, 'kg')} ${res.name}`, res.hex, cx, cy);
                    }
                } else {
                    // Homebase / Refinery / Oil Well / Power Plant → request + manage dialog.
                    if (structure instanceof Refinery) {
                        const inputNames = structure.inputResources.map(r => r.name);
                        this.hud.showContext(structure.label,
                            [...inputNames, structure.providesResource!.name]);
                    } else if (structure instanceof PowerPlant) {
                        this.hud.showContext('Power Plant', [structure.fuelResource.name, 'Electricity']);
                    } else {
                        this.hud.showHomebase();
                    }
                    this._openRequestDialog(structure);
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
            // Draw the haul path only when the truck is actually on a job.
            this._select(transport.mesh, transport.isIdle ? undefined : transport);
            this.hud.showHomebase();
            this.showInfo(transport.getStatsLines());
            return;
        }

        // ── Nothing hit ───────────────────────────────────────────────────────
        this._select(null);
        this.hud.showHomebase();
        this.showInfo([]);
    }

    // ── Request dialogue ──────────────────────────────────────────────────────
    // Tap a destination structure → pick a resource it accepts → pick a quantity.
    // A transport request is queued; idle transports self-assign to it.

    // Resources a structure accepts as a delivery destination.
    private _acceptedResources(structure: Structure): Resource[] {
        return this.resources.filter(r => {
            const role = structure.getResourceRole(r);
            return role === 'input' || role === 'both';
        });
    }

    // Is there a structure that can supply `res` right now (has a source with stock)?
    private _hasSource(res: Resource, destNormal: Vector3): boolean {
        if (!resolveSource(res, this.structures, destNormal)) return false;
        return res.isManufactured ? true : res.deposit > 0;
    }

    private _openRequestDialog(structure: Structure): void {
        this.requestStructure = structure;
        this.requestTitle.textContent = `Deliver to ${structure.label}`;
        const deletable = structure instanceof Refinery || structure instanceof OilWell || structure instanceof PowerPlant;
        this.requestDeleteBtn.style.display = deletable ? 'block' : 'none';
        this._showRequestResources(structure);
        this.requestOverlay.style.display = 'flex';
    }

    private _closeRequestDialog(): void {
        this.requestOverlay.style.display = 'none';
        this.requestStructure = null;
    }

    private _showRequestResources(structure: Structure): void {
        this.requestBody.innerHTML = '';
        const accepted = this._acceptedResources(structure);

        if (!accepted.length) {
            const empty = document.createElement('div');
            Object.assign(empty.style, {
                fontSize: '12px', color: '#555', padding: '6px 0',
                fontFamily: '-apple-system, sans-serif',
            });
            empty.textContent = 'Source only — nothing to deliver here.';
            this.requestBody.appendChild(empty);
            return;
        }

        this.requestBody.appendChild(this._sectionLabel('REQUEST RESOURCE'));
        const destNormal = structure.surfaceNormal;
        for (const res of accepted) {
            const hasSource = this._hasSource(res, destNormal);
            const sub = hasSource ? '' : (res.isManufactured ? 'no producer' : 'no source / depleted');
            const btn = this._rowButton(res.name, sub, res.hex);
            if (!hasSource) {
                btn.style.opacity = '0.45';
                (btn as HTMLButtonElement).disabled = true;
            } else {
                btn.addEventListener('click', () => this._showRequestQuantity(structure, res));
            }
            this.requestBody.appendChild(btn);
        }
    }

    private _showRequestQuantity(structure: Structure, res: Resource): void {
        this.requestBody.innerHTML = '';

        const back = document.createElement('button');
        back.textContent = '← Back';
        Object.assign(back.style, {
            background: 'none', border: 'none', color: '#555',
            fontSize: '12px', cursor: 'pointer', padding: '0 0 8px 0',
            fontFamily: '-apple-system, sans-serif', textAlign: 'left',
        });
        back.addEventListener('click', () => this._showRequestResources(structure));
        this.requestBody.appendChild(back);

        this.requestBody.appendChild(this._sectionLabel(`HOW MUCH ${res.name.toUpperCase()}?`));

        for (const qty of InputHandler.QTY_PRESETS) {
            const btn = this._rowButton(formatScaled(qty, 'kg'), '', res.hex);
            btn.addEventListener('click', () => {
                if (this.createRequestCallback) {
                    this.createRequestCallback(structure.surfaceNormal, structure.label, res, qty);
                }
                this._closeRequestDialog();
                this.saveCallback();
            });
            this.requestBody.appendChild(btn);
        }
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

    private _makeRequestOverlay(): HTMLElement {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '40',
            display: 'none', alignItems: 'center', justifyContent: 'center',
        });

        const backdrop = document.createElement('div');
        Object.assign(backdrop.style, {
            position: 'absolute', inset: '0', background: 'rgba(0,0,0,0.6)',
        });
        backdrop.addEventListener('click', () => this._closeRequestDialog());

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
        this.requestTitle = document.createElement('div');
        Object.assign(this.requestTitle.style, {
            fontSize: '11px', fontWeight: '600', letterSpacing: '1.5px',
            textTransform: 'uppercase', color: '#666',
        });
        const closeX = document.createElement('button');
        closeX.textContent = '✕';
        Object.assign(closeX.style, {
            background: 'none', border: 'none', color: '#555',
            fontSize: '18px', cursor: 'pointer', padding: '4px',
        });
        closeX.addEventListener('click', () => this._closeRequestDialog());
        headerRow.append(this.requestTitle, closeX);

        this.requestBody = document.createElement('div');
        Object.assign(this.requestBody.style, { display: 'flex', flexDirection: 'column' });

        this.requestDeleteBtn = document.createElement('button');
        Object.assign(this.requestDeleteBtn.style, {
            padding: '10px', background: 'rgba(220,53,69,0.12)',
            border: '1px solid rgba(220,53,69,0.35)',
            borderRadius: '10px', color: '#e05060',
            fontSize: '13px', cursor: 'pointer', display: 'none',
        });
        this.requestDeleteBtn.textContent = 'Delete Structure';
        this.requestDeleteBtn.addEventListener('click', () => {
            const s = this.requestStructure;
            if (!s || !this.deleteCallback) return;
            this._select(null);
            this._closeRequestDialog();
            this.deleteCallback(s);
        });

        card.append(headerRow, this.requestBody, this.requestDeleteBtn);
        overlay.append(backdrop, card);
        document.body.appendChild(overlay);
        return overlay;
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
}
