import { Vector3 } from 'three';
import { Resource } from './resource';
import { Transport, resolveSourceNormal } from './transport';
import { Structure } from './structure';
import { Homebase } from './homebase';
import { Refinery } from './refinery';

interface Sample {
    time:     number;
    gathered: Record<string, number>;
}

interface TruckGroup {
    transports: Transport[];
    sourceName: string;
    sourceHex:  string;
    destName:   string;
}

const SAMPLE_MS   = 30_000;
const MAX_SAMPLES = 120;

export class StatsPanel {
    private panel:     HTMLElement;
    private canvas:    HTMLCanvasElement;
    private ctx:       CanvasRenderingContext2D;
    private history:   Sample[] = [];
    private visible    = false;
    private idleBadge: HTMLButtonElement;
    private totalEl:   HTMLElement;

    private idleOverlay: HTMLElement;
    private idleList:    HTMLElement;

    private pickOverlay: HTMLElement;
    private pickList:    HTMLElement;

    private selectedTransports = new Set<Transport>();
    private idleAssignBtn!: HTMLButtonElement;
    private idleBtnMap     = new Map<Transport, HTMLElement>();
    private structures:    Structure[] = [];

    // Transportation section (persistent shell + dynamic route rows)
    private transportsSection!: HTMLElement;
    private routeRowsEl!:       HTMLElement;

    // Structure utilization section
    private structuresSection!: HTMLElement;

    // 3-step route reassign overlay (launched from allocation rows)
    private routeOverlay!:    HTMLElement;
    private routeBody!:       HTMLElement;
    private routeGroupTs:     Transport[] = [];
    private routeCount        = 1;
    private routeDestNormal:  Vector3 | null = null;
    private routeDestName     = '';
    private routeSourceName   = '';

    private saveCallback: () => void = () => {};

    setStructures(structures: Structure[]): void { this.structures = structures; }
    setSaveCallback(fn: () => void): void { this.saveCallback = fn; }

    constructor(
        private resources:  Resource[],
        private transports: Transport[],
    ) {
        // ── Panel shell ───────────────────────────────────────────────────────
        this.panel = document.createElement('div');
        Object.assign(this.panel.style, {
            position: 'fixed', inset: '0', zIndex: '28',
            display: 'none', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.75)',
        });

        const card = document.createElement('div');
        Object.assign(card.style, {
            background:   'rgba(10,10,16,0.98)',
            border:       '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px', padding: '20px',
            width: 'min(520px, 92vw)', maxHeight: '80vh',
            display: 'flex', flexDirection: 'column', gap: '12px',
            overflowY: 'auto',
        });

        // header
        const header = document.createElement('div');
        Object.assign(header.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
        const titleEl = document.createElement('span');
        titleEl.textContent = 'Resource Stats';
        Object.assign(titleEl.style, {
            fontSize: '11px', fontWeight: '600', letterSpacing: '2px',
            textTransform: 'uppercase', color: '#888', fontFamily: '-apple-system, sans-serif',
        });
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, {
            background: 'none', border: 'none', color: '#555',
            fontSize: '18px', cursor: 'pointer', padding: '4px',
            fontFamily: '-apple-system, sans-serif',
        });
        closeBtn.addEventListener('click', () => this.toggle());
        header.append(titleEl, closeBtn);

        // canvas
        this.canvas = document.createElement('canvas');
        Object.assign(this.canvas.style, { width: '100%', height: '340px', borderRadius: '8px' });
        this.ctx = this.canvas.getContext('2d')!;

        // ── Transport section (label + idle row + route rows) ─────────────────
        this.transportsSection = document.createElement('div');
        Object.assign(this.transportsSection.style, {
            display: 'flex', flexDirection: 'column', gap: '4px',
        });

        // Section label row (label + total count)
        const transportLabelRow = document.createElement('div');
        Object.assign(transportLabelRow.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        });
        const transportLabel = document.createElement('div');
        transportLabel.textContent = 'Transport';
        Object.assign(transportLabel.style, {
            fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
            color: '#444', fontFamily: '-apple-system, sans-serif',
        });
        this.totalEl = document.createElement('span');
        Object.assign(this.totalEl.style, {
            fontSize: '9px', color: '#555', fontFamily: '-apple-system, sans-serif',
            letterSpacing: '0.5px',
        });
        transportLabelRow.append(transportLabel, this.totalEl);

        // Idle row (persistent — badge updated by _updateIdleBadge)
        const idleRow = document.createElement('div');
        Object.assign(idleRow.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '8px', fontFamily: '-apple-system, sans-serif',
        });
        const idleLabel = document.createElement('span');
        idleLabel.textContent = 'Idle';
        Object.assign(idleLabel.style, { fontSize: '12px', color: '#666' });

        this.idleBadge = document.createElement('button');
        Object.assign(this.idleBadge.style, {
            background: 'rgba(255,180,0,0.15)', border: '1px solid rgba(255,180,0,0.3)',
            borderRadius: '6px', padding: '2px 12px',
            color: '#ffb400', fontSize: '13px', fontWeight: '600',
            cursor: 'pointer', fontFamily: '-apple-system, sans-serif',
        });
        this.idleBadge.addEventListener('click', () => this._openIdleList());
        idleRow.append(idleLabel, this.idleBadge);

        // Route rows rebuilt on each render
        this.routeRowsEl = document.createElement('div');
        Object.assign(this.routeRowsEl.style, {
            display: 'flex', flexDirection: 'column', gap: '4px',
        });

        this.transportsSection.append(transportLabelRow, idleRow, this.routeRowsEl);

        // structures utilization section
        this.structuresSection = document.createElement('div');
        Object.assign(this.structuresSection.style, {
            display: 'flex', flexDirection: 'column', gap: '4px',
        });

        card.append(header, this.canvas, this.transportsSection, this.structuresSection);
        this.panel.appendChild(card);
        document.body.appendChild(this.panel);
        this.panel.addEventListener('click', e => { if (e.target === this.panel) this.toggle(); });

        // ── Idle list overlay ─────────────────────────────────────────────────
        this.idleOverlay = this._makeOverlay(29);
        const idleCard   = this._makeCard();
        this.idleList    = document.createElement('div');
        Object.assign(this.idleList.style, { display: 'flex', flexDirection: 'column', gap: '8px' });

        this.idleAssignBtn = document.createElement('button');
        Object.assign(this.idleAssignBtn.style, {
            marginTop: '4px', padding: '10px',
            background: 'rgba(255,180,0,0.15)', border: '1px solid rgba(255,180,0,0.35)',
            borderRadius: '8px', color: '#ffb400', fontSize: '13px', fontWeight: '600',
            cursor: 'pointer', fontFamily: '-apple-system, sans-serif',
        });
        this.idleAssignBtn.textContent = 'Assign';
        this.idleAssignBtn.disabled = true;
        this.idleAssignBtn.style.opacity = '0.4';
        this.idleAssignBtn.addEventListener('click', () => this._openPickModal());

        idleCard.append(
            this._makeCardTitle('Idle Transports'),
            this.idleList,
            this.idleAssignBtn,
            this._makeCancelBtn(() => {
                this.idleOverlay.style.display = 'none';
                this.selectedTransports.clear();
                this.idleBtnMap.clear();
            }),
        );
        this.idleOverlay.appendChild(idleCard);
        document.body.appendChild(this.idleOverlay);

        // ── Resource pick overlay ─────────────────────────────────────────────
        this.pickOverlay = this._makeOverlay(30);
        const pickCard   = this._makeCard();
        this.pickList    = document.createElement('div');
        Object.assign(this.pickList.style, { display: 'flex', flexDirection: 'column', gap: '8px' });
        pickCard.append(
            this._makeCardTitle('Collect Resource'),
            this.pickList,
            this._makeCancelBtn(() => { this.pickOverlay.style.display = 'none'; }),
        );
        this.pickOverlay.appendChild(pickCard);
        document.body.appendChild(this.pickOverlay);

        // ── Route reassign overlay (3-step) ───────────────────────────────────
        this._buildRouteOverlay();

        // start sampling
        this._sample();
        setInterval(() => this._sample(), SAMPLE_MS);
    }

    toggle(): void {
        this.visible = !this.visible;
        this.panel.style.display = this.visible ? 'flex' : 'none';
        if (this.visible) {
            this._updateIdleBadge();
            this._renderTransportAllocation();
            this._renderStructures();
            this._render();
        }
    }

    // ── Transportation allocation ─────────────────────────────────────────────

    private _truckGroups(): TruckGroup[] {
        const map = new Map<string, TruckGroup>();
        for (const t of this.transports) {
            if (t.stopped) continue;
            const resolvedDest = t.resolveDestName(this.structures);
            const key = `${t.sourceResource.name}|${resolvedDest}`;
            if (!map.has(key)) {
                map.set(key, {
                    transports: [],
                    sourceName: t.sourceResource.name,
                    sourceHex:  t.sourceResource.hex,
                    destName:   resolvedDest,
                });
            }
            map.get(key)!.transports.push(t);
        }
        return [...map.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName));
    }

    private _renderTransportAllocation(): void {
        this.routeRowsEl.innerHTML = '';
        const groups = this._truckGroups();

        for (const g of groups) {
            const row = document.createElement('button');
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '9px 12px', width: '100%',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '8px', cursor: 'pointer',
                fontFamily: '-apple-system, sans-serif', textAlign: 'left',
            });

            const swatch = document.createElement('span');
            Object.assign(swatch.style, {
                width: '10px', height: '10px', borderRadius: '2px',
                background: g.sourceHex, flexShrink: '0',
            });

            // Resource name
            const resEl = document.createElement('span');
            resEl.textContent = g.sourceName;
            Object.assign(resEl.style, { fontSize: '13px', color: '#ccc', minWidth: '52px' });

            // Destination
            const destEl = document.createElement('span');
            destEl.textContent = `→ ${g.destName}`;
            Object.assign(destEl.style, { flex: '1', fontSize: '12px', color: '#888' });

            // Truck count
            const countEl = document.createElement('span');
            countEl.textContent = `×${g.transports.length}`;
            Object.assign(countEl.style, { fontSize: '13px', fontWeight: '600', color: '#aaa' });

            const arrow = document.createElement('span');
            arrow.textContent = '›';
            Object.assign(arrow.style, { fontSize: '16px', color: '#444', paddingLeft: '4px' });

            row.append(swatch, resEl, destEl, countEl, arrow);
            row.addEventListener('click', () => this._openRouteReassign(g));
            this.routeRowsEl.appendChild(row);
        }
    }

    // ── Structure utilization ─────────────────────────────────────────────────

    private _renderStructures(): void {
        this.structuresSection.innerHTML = '';

        // Only show built structures (Refinery, OilWell) — skip world nodes/homebase
        const built = this.structures.filter(
            s => s.label === 'Refinery' || s.label === 'Oil Well',
        );
        if (!built.length) return;

        const label = document.createElement('div');
        label.textContent = 'Structures';
        Object.assign(label.style, {
            fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
            color: '#444', fontFamily: '-apple-system, sans-serif',
            marginTop: '4px',
        });
        this.structuresSection.appendChild(label);

        let idx = 0;
        for (const s of built) {
            idx++;
            const { pct, limitedBy } = s.getUtilization();
            const barColor = pct >= 80 ? '#4caf50' : pct >= 40 ? '#ffb300' : '#e53935';

            const row = document.createElement('div');
            Object.assign(row.style, {
                display: 'flex', flexDirection: 'column', gap: '4px',
                padding: '9px 12px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '8px',
                fontFamily: '-apple-system, sans-serif',
            });

            // Name + percentage
            const topRow = document.createElement('div');
            Object.assign(topRow.style, { display: 'flex', alignItems: 'center', gap: '8px' });

            const nameEl = document.createElement('span');
            nameEl.textContent = `${s.label} #${idx}`;
            Object.assign(nameEl.style, { flex: '1', fontSize: '13px', color: '#ccc' });

            const pctEl = document.createElement('span');
            pctEl.textContent = `${pct}%`;
            Object.assign(pctEl.style, { fontSize: '13px', fontWeight: '600', color: barColor });

            topRow.append(nameEl, pctEl);

            // Bar
            const barTrack = document.createElement('div');
            Object.assign(barTrack.style, {
                height: '4px', borderRadius: '2px',
                background: 'rgba(255,255,255,0.08)', overflow: 'hidden',
            });
            const barFill = document.createElement('div');
            Object.assign(barFill.style, {
                height: '100%', width: `${pct}%`,
                background: barColor, borderRadius: '2px',
                transition: 'width 0.3s',
            });
            barTrack.appendChild(barFill);

            row.append(topRow, barTrack);

            // Bottleneck label
            if (limitedBy) {
                const limEl = document.createElement('div');
                limEl.textContent = `Limited by: ${limitedBy}`;
                Object.assign(limEl.style, { fontSize: '10px', color: '#888' });
                row.appendChild(limEl);
            }

            this.structuresSection.appendChild(row);
        }
    }

    // ── Route reassign 3-step overlay ─────────────────────────────────────────

    private _buildRouteOverlay(): void {
        this.routeOverlay = this._makeOverlay(31);

        const backdrop = document.createElement('div');
        Object.assign(backdrop.style, { position: 'absolute', inset: '0' });
        backdrop.addEventListener('click', () => { this.routeOverlay.style.display = 'none'; });

        const card = this._makeCard();
        Object.assign(card.style, {
            position: 'relative', zIndex: '1', minWidth: 'min(300px, 90vw)',
        });

        const headerRow = document.createElement('div');
        Object.assign(headerRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
        const hTitle = this._makeCardTitle('Reassign Trucks');
        const closeX = document.createElement('button');
        closeX.textContent = '✕';
        Object.assign(closeX.style, {
            background: 'none', border: 'none', color: '#555',
            fontSize: '18px', cursor: 'pointer', padding: '4px',
        });
        closeX.addEventListener('click', () => { this.routeOverlay.style.display = 'none'; });
        headerRow.append(hTitle, closeX);

        this.routeBody = document.createElement('div');
        Object.assign(this.routeBody.style, { display: 'flex', flexDirection: 'column', gap: '6px' });

        card.append(headerRow, this.routeBody);
        this.routeOverlay.append(backdrop, card);
        document.body.appendChild(this.routeOverlay);
    }

    private _openRouteReassign(g: TruckGroup): void {
        this.routeGroupTs   = [...g.transports];
        this.routeCount     = g.transports.length;
        this.routeSourceName = g.sourceName;
        this.routeDestNormal = null;
        this.routeDestName  = '';
        this._showRouteStep1(g);
        this.routeOverlay.style.display = 'flex';
    }

    private _showRouteStep1(g: TruckGroup): void {
        this.routeBody.innerHTML = '';

        // Current route info
        const info = document.createElement('div');
        info.textContent = `${g.sourceName} → ${g.destName}  ×${g.transports.length}`;
        Object.assign(info.style, { fontSize: '12px', color: '#555', fontFamily: '-apple-system, sans-serif', marginBottom: '4px' });
        this.routeBody.appendChild(info);

        // Section label
        this.routeBody.appendChild(this._routeLabel('How many to reassign?'));

        // Stepper row
        const stepper = document.createElement('div');
        Object.assign(stepper.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px',
            padding: '8px 0',
        });

        const countDisplay = document.createElement('span');
        countDisplay.textContent = String(this.routeCount);
        Object.assign(countDisplay.style, {
            fontSize: '28px', fontWeight: '600', color: '#fff', minWidth: '40px', textAlign: 'center',
            fontFamily: '-apple-system, sans-serif',
        });

        const mkStep = (delta: number, label: string) => {
            const btn = document.createElement('button');
            btn.textContent = label;
            Object.assign(btn.style, {
                width: '36px', height: '36px', borderRadius: '50%',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                color: '#ccc', fontSize: '20px', cursor: 'pointer', lineHeight: '1',
                fontFamily: '-apple-system, sans-serif',
            });
            btn.addEventListener('click', () => {
                this.routeCount = Math.min(g.transports.length, Math.max(1, this.routeCount + delta));
                countDisplay.textContent = String(this.routeCount);
            });
            return btn;
        };

        stepper.append(mkStep(-1, '−'), countDisplay, mkStep(1, '+'));
        this.routeBody.appendChild(stepper);

        const nextBtn = this._accentBtn('Choose Destination →');
        nextBtn.addEventListener('click', () => this._showRouteStep2());
        this.routeBody.appendChild(nextBtn);
    }

    private _showRouteStep2(): void {
        this.routeBody.innerHTML = '';

        this.routeBody.appendChild(this._backBtn(() => {
            const g = this._truckGroups().find(x =>
                x.sourceName === this.routeSourceName && x.transports.length > 0
            ) ?? { transports: this.routeGroupTs, sourceName: this.routeSourceName, sourceHex: '', destName: '' };
            this._showRouteStep1(g as TruckGroup);
        }));
        this.routeBody.appendChild(this._routeLabel('Deliver to'));

        const destinations = this._destinations();
        for (const dest of destinations) {
            const btn = this._rowBtn(dest.name);
            btn.addEventListener('click', () => {
                this.routeDestNormal = dest.normal;
                this.routeDestName   = dest.name;
                this._showRouteStep3();
            });
            this.routeBody.appendChild(btn);
        }
    }

    private _showRouteStep3(): void {
        if (!this.routeDestNormal) return;
        const destNormal = this.routeDestNormal;
        const destName   = this.routeDestName;

        this.routeBody.innerHTML = '';

        this.routeBody.appendChild(this._backBtn(() => this._showRouteStep2()));
        this.routeBody.appendChild(this._routeLabel(`Collect resource → ${destName}`));

        const availableResources = this.resources.filter(r =>
            this.structures.some(s => s.getResourceRole(r) === 'output'),
        );
        for (const res of availableResources) {
            const srcNormal = resolveSourceNormal(res, this.structures, destNormal);
            const distKm    = (Math.acos(Math.min(1, Math.max(-1, destNormal.dot(srcNormal)))) * 6_371_000 / 1000).toFixed(1);

            const btn = this._rowBtn(res.name, `${distKm} km`, res.hex);
            btn.addEventListener('click', () => {
                const trucks = this.routeGroupTs.slice(0, this.routeCount);
                for (const t of trucks) t.reassignRoute(destNormal, destName, res, this.structures);
                this.saveCallback();
                this.routeOverlay.style.display = 'none';
                this._renderTransportAllocation();
            });
            this.routeBody.appendChild(btn);
        }

        const n = this.routeCount;
        const confirmInfo = document.createElement('div');
        confirmInfo.textContent = `Tap a resource to reassign ${n} truck${n > 1 ? 's' : ''}`;
        Object.assign(confirmInfo.style, {
            fontSize: '10px', color: '#444', textAlign: 'center',
            fontFamily: '-apple-system, sans-serif', paddingTop: '4px',
        });
        this.routeBody.appendChild(confirmInfo);
    }

    // ── Destinations helper ───────────────────────────────────────────────────

    private _destinations(): Array<{ name: string; normal: Vector3 }> {
        const dests: Array<{ name: string; normal: Vector3 }> = [];
        let refIdx = 1;
        for (const s of this.structures) {
            if (s instanceof Homebase) {
                dests.unshift({ name: s.label, normal: s.surfaceNormal.clone() });
            } else if (s instanceof Refinery) {
                dests.push({ name: `Refinery #${refIdx++}`, normal: s.surfaceNormal.clone() });
            }
        }
        return dests;
    }

    // ── Small DOM helpers ─────────────────────────────────────────────────────

    private _routeLabel(text: string): HTMLElement {
        const el = document.createElement('div');
        el.textContent = text;
        Object.assign(el.style, {
            fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
            color: '#444', fontFamily: '-apple-system, sans-serif', margin: '4px 0 2px',
        });
        return el;
    }

    private _backBtn(onClick: () => void): HTMLElement {
        const btn = document.createElement('button');
        btn.textContent = '← Back';
        Object.assign(btn.style, {
            background: 'none', border: 'none', color: '#555',
            fontSize: '12px', cursor: 'pointer', padding: '0 0 6px 0',
            fontFamily: '-apple-system, sans-serif', textAlign: 'left',
        });
        btn.addEventListener('click', onClick);
        return btn;
    }

    private _rowBtn(label: string, sub?: string, swatchColor?: string): HTMLElement {
        const btn = document.createElement('button');
        Object.assign(btn.style, {
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '9px 11px', width: '100%',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px', cursor: 'pointer',
            color: '#ddd', fontFamily: '-apple-system, sans-serif', fontSize: '13px',
        });
        if (swatchColor) {
            const sw = document.createElement('span');
            Object.assign(sw.style, {
                width: '10px', height: '10px', borderRadius: '2px',
                background: swatchColor, flexShrink: '0',
            });
            btn.appendChild(sw);
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

    private _accentBtn(text: string): HTMLElement {
        const btn = document.createElement('button');
        btn.textContent = text;
        Object.assign(btn.style, {
            padding: '10px', marginTop: '4px',
            background: 'rgba(255,180,0,0.12)', border: '1px solid rgba(255,180,0,0.3)',
            borderRadius: '8px', color: '#ffb400', fontSize: '13px', fontWeight: '600',
            cursor: 'pointer', fontFamily: '-apple-system, sans-serif', width: '100%',
        });
        return btn;
    }

    // ── Overlay helpers ───────────────────────────────────────────────────────

    private _makeOverlay(z: number): HTMLElement {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'fixed', inset: '0', zIndex: String(z),
            display: 'none', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
        });
        return el;
    }

    private _makeCard(): HTMLElement {
        const el = document.createElement('div');
        Object.assign(el.style, {
            background: 'rgba(14,14,20,0.98)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px', padding: '20px',
            width: 'min(300px, 90vw)', maxHeight: '70vh',
            display: 'flex', flexDirection: 'column', gap: '10px',
            overflowY: 'auto',
        });
        return el;
    }

    private _makeCardTitle(text: string): HTMLElement {
        const el = document.createElement('div');
        el.textContent = text;
        Object.assign(el.style, {
            fontSize: '11px', fontWeight: '600', letterSpacing: '2px',
            textTransform: 'uppercase', color: '#666',
            fontFamily: '-apple-system, sans-serif',
        });
        return el;
    }

    private _makeCancelBtn(onClick: () => void): HTMLElement {
        const btn = document.createElement('button');
        btn.textContent = 'Cancel';
        Object.assign(btn.style, {
            marginTop: '4px', padding: '9px',
            background: 'none', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px', color: '#555', fontSize: '13px',
            cursor: 'pointer', fontFamily: '-apple-system, sans-serif',
        });
        btn.addEventListener('click', onClick);
        return btn;
    }

    private _makeListBtn(): HTMLElement {
        const btn = document.createElement('button');
        Object.assign(btn.style, {
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 12px', width: '100%',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '10px', color: '#ddd',
            cursor: 'pointer', textAlign: 'left',
            fontFamily: '-apple-system, sans-serif',
        });
        return btn;
    }

    // ── Idle flow ─────────────────────────────────────────────────────────────

    private _updateIdleBadge(): void {
        const total = this.transports.length;
        const idle  = this.transports.filter(t => t.stopped).length;
        this.totalEl.textContent     = `${total} total`;
        this.idleBadge.textContent   = String(idle);
        this.idleBadge.disabled      = idle === 0;
        this.idleBadge.style.opacity = idle > 0 ? '1' : '0.4';
    }

    private _openIdleList(): void {
        const idle = this.transports.filter(t => t.stopped);
        if (idle.length === 0) return;

        this.selectedTransports.clear();
        this.idleBtnMap.clear();
        this.idleList.innerHTML = '';
        this._refreshAssignBtn();

        for (const t of idle) {
            const btn  = this._makeListBtn();
            const icon = document.createElement('span');
            icon.textContent = '🚛';
            icon.style.fontSize = '18px';

            const info = document.createElement('span');
            Object.assign(info.style, { display: 'flex', flexDirection: 'column', gap: '2px' });
            const name = document.createElement('span');
            name.textContent = `${t.spec.name} #${t.id}`;
            Object.assign(name.style, { fontSize: '13px', fontWeight: '500' });
            const sub = document.createElement('span');
            sub.textContent = `was hauling ${t.sourceResource.name}`;
            Object.assign(sub.style, { fontSize: '10px', color: '#555' });
            info.append(name, sub);

            const check = document.createElement('span');
            check.textContent = '✓';
            Object.assign(check.style, {
                marginLeft: 'auto', fontSize: '16px', color: '#ffb400',
                visibility: 'hidden', flexShrink: '0',
            });

            btn.append(icon, info, check);
            btn.addEventListener('click', () => {
                if (this.selectedTransports.has(t)) {
                    this.selectedTransports.delete(t);
                    check.style.visibility = 'hidden';
                    btn.style.border       = '1px solid rgba(255,255,255,0.08)';
                    btn.style.background   = 'rgba(255,255,255,0.04)';
                } else {
                    this.selectedTransports.add(t);
                    check.style.visibility = 'visible';
                    btn.style.border       = '1px solid rgba(255,180,0,0.4)';
                    btn.style.background   = 'rgba(255,180,0,0.08)';
                }
                this._refreshAssignBtn();
            });

            this.idleBtnMap.set(t, btn);
            this.idleList.appendChild(btn);
        }

        this.idleOverlay.style.display = 'flex';
    }

    private _refreshAssignBtn(): void {
        const n = this.selectedTransports.size;
        this.idleAssignBtn.disabled    = n === 0;
        this.idleAssignBtn.style.opacity = n > 0 ? '1' : '0.4';
        this.idleAssignBtn.textContent = n > 1 ? `Assign ${n} Trucks` : 'Assign';
    }

    private _openPickModal(): void {
        this.pickList.innerHTML = '';
        for (const r of this.resources) {
            const btn    = this._makeListBtn();
            const swatch = document.createElement('span');
            Object.assign(swatch.style, {
                width: '14px', height: '14px', borderRadius: '4px',
                background: r.hex, flexShrink: '0', display: 'inline-block',
            });
            const label = document.createElement('span');
            label.textContent = r.name;
            Object.assign(label.style, { fontSize: '13px', fontWeight: '500' });
            btn.append(swatch, label);
            btn.addEventListener('click', () => this._assign(r));
            this.pickList.appendChild(btn);
        }
        this.pickOverlay.style.display = 'flex';
    }

    private _assign(resource: Resource): void {
        for (const t of this.selectedTransports) t.reassign(resource, this.structures);
        this.selectedTransports.clear();
        this.idleBtnMap.clear();
        this.pickOverlay.style.display = 'none';
        this.idleOverlay.style.display = 'none';
        this._updateIdleBadge();
    }

    // ── Sampling ──────────────────────────────────────────────────────────────

    private _sample(): void {
        const snap: Record<string, number> = {};
        for (const r of this.resources) snap[r.name] = r.gathered;
        this.history.push({ time: Date.now(), gathered: snap });
        if (this.history.length > MAX_SAMPLES) this.history.shift();
        if (this.visible) { this._updateIdleBadge(); this._render(); }
    }

    // ── Rendering ─────────────────────────────────────────────────────────────

    private _render(): void {
        const dpr = window.devicePixelRatio || 1;
        const cssW = this.canvas.clientWidth;
        const cssH = this.canvas.clientHeight;
        this.canvas.width  = cssW * dpr;
        this.canvas.height = cssH * dpr;
        const ctx = this.ctx;
        ctx.scale(dpr, dpr);
        const W = cssW, H = cssH;

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(0, 0, W, H);

        if (this.history.length < 2) {
            ctx.fillStyle = '#444';
            ctx.font = '13px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Collecting data…', W / 2, H / 2);
            return;
        }

        const n   = this.history.length;
        const pad = { l: 56, r: 16, t: 14, b: 22, mid: 28 };
        const h1  = (H - pad.t - pad.b - pad.mid) / 2;
        const y1  = pad.t;
        const y2  = pad.t + h1 + pad.mid;

        this._drawSubChart(ctx, W, pad.l, pad.r, y1, h1, 'Accumulated',
            (i) => {
                const g = this.history[i].gathered;
                return this.resources.map(r => ({ name: r.name, color: r.hex, value: g[r.name] ?? 0 }));
            },
            (v) => v >= 1e12 ? `${(v/1e12).toFixed(1)}Gt`
                 : v >= 1e9  ? `${(v/1e9).toFixed(1)}Mt`
                 : v >= 1e6  ? `${(v/1e6).toFixed(1)}kt`
                 : v >= 1e3  ? `${(v/1e3).toFixed(0)}t`
                 : `${v.toFixed(0)}kg`,
        );

        this._drawSubChart(ctx, W, pad.l, pad.r, y2, h1, 'Rate  kg/min',
            (i) => {
                if (i === 0) return this.resources.map(r => ({ name: r.name, color: r.hex, value: 0 }));
                const dt = (this.history[i].time - this.history[i - 1].time) / 60_000;
                return this.resources.map(r => ({
                    name:  r.name,
                    color: r.hex,
                    value: Math.max(0, ((this.history[i].gathered[r.name] ?? 0)
                                     - (this.history[i - 1].gathered[r.name] ?? 0)) / dt),
                }));
            },
            (v) => v >= 1e3 ? `${(v/1e3).toFixed(1)}t` : `${v.toFixed(0)}`,
        );

        this._drawLegend(ctx, W, H - 4);
    }

    private _drawSubChart(
        ctx:      CanvasRenderingContext2D,
        W:        number,
        padL:     number,
        padR:     number,
        top:      number,
        height:   number,
        label:    string,
        getValue: (i: number) => Array<{ name: string; color: string; value: number }>,
        fmtY:     (v: number) => string,
    ): void {
        const n    = this.history.length;
        const left = padL, right = W - padR;
        const chartW = right - left;

        const series = this.resources.map((_, ri) =>
            this.history.map((_, i) => getValue(i)[ri].value)
        );

        let maxVal = 1;
        for (const s of series) for (const v of s) if (v > maxVal) maxVal = v;

        const xOf = (i: number) => left + (i / (n - 1)) * chartW;
        const yOf = (v: number) => top + height - (v / maxVal) * height;

        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth   = 1;
        for (let tick = 0; tick <= 4; tick++) {
            const y = top + (tick / 4) * height;
            ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        }

        ctx.fillStyle    = '#444';
        ctx.font         = '9px -apple-system, sans-serif';
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'middle';
        for (let tick = 0; tick <= 2; tick++) {
            const v = maxVal * (1 - tick / 2);
            const y = top + (tick / 2) * height;
            ctx.fillText(fmtY(v), left - 4, y);
        }

        ctx.fillStyle    = '#555';
        ctx.font         = '9px -apple-system, sans-serif';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(label, left, top);

        const totalMinutes = (this.history[n - 1].time - this.history[0].time) / 60_000;
        ctx.fillStyle    = '#444';
        ctx.font         = '9px -apple-system, sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign    = 'left';
        ctx.fillText('0', left, top + height + 4);
        ctx.textAlign = 'right';
        ctx.fillText(`${totalMinutes.toFixed(0)} min`, right, top + height + 4);

        for (let ri = 0; ri < this.resources.length; ri++) {
            const s = series[ri];
            ctx.strokeStyle = this.resources[ri].hex;
            ctx.lineWidth   = 1.5;
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const x = xOf(i), y = yOf(s[i]);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    }

    private _drawLegend(ctx: CanvasRenderingContext2D, W: number, y: number): void {
        const itemW = W / this.resources.length;
        ctx.font         = '9px -apple-system, sans-serif';
        ctx.textBaseline = 'bottom';
        for (let i = 0; i < this.resources.length; i++) {
            const r  = this.resources[i];
            const cx = i * itemW + itemW / 2;
            ctx.fillStyle = r.hex;
            ctx.fillRect(cx - 16, y - 7, 10, 7);
            ctx.fillStyle = '#666';
            ctx.textAlign = 'left';
            ctx.fillText(r.name, cx - 4, y);
        }
    }
}
