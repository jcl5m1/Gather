import { Resource, formatScaled } from './resource';
import { Transport, resolveSource } from './transport';
import { TransportQueue, TransportRequest } from './transportRequest';
import { Structure } from './structure';

interface Sample {
    time:     number;
    gathered: Record<string, number>;
}

const SAMPLE_MS   = 30_000;
const MAX_SAMPLES = 120;

export class StatsPanel {
    private panel:     HTMLElement;
    private canvas:    HTMLCanvasElement;
    private ctx:       CanvasRenderingContext2D;
    private history:   Sample[] = [];
    private visible    = false;
    private totalEl:   HTMLElement;

    private structures: Structure[] = [];
    private queue:      TransportQueue | null = null;

    // Transport section (persistent shell + dynamic request rows)
    private transportsSection!: HTMLElement;
    private requestRowsEl!:     HTMLElement;

    // Structure utilization section
    private structuresSection!: HTMLElement;

    private saveCallback:   () => void = () => {};
    private cancelCallback: (req: TransportRequest) => void = () => {};

    setStructures(structures: Structure[]): void { this.structures = structures; }
    setSaveCallback(fn: () => void): void { this.saveCallback = fn; }
    setQueue(queue: TransportQueue): void { this.queue = queue; }
    setCancelRequestCallback(fn: (req: TransportRequest) => void): void { this.cancelCallback = fn; }

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

        // ── Transport request section ─────────────────────────────────────────
        this.transportsSection = document.createElement('div');
        Object.assign(this.transportsSection.style, {
            display: 'flex', flexDirection: 'column', gap: '4px',
        });

        const labelRow = document.createElement('div');
        Object.assign(labelRow.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        });
        const label = document.createElement('div');
        label.textContent = 'Transport Job Market';
        Object.assign(label.style, {
            fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
            color: '#444', fontFamily: '-apple-system, sans-serif',
        });
        this.totalEl = document.createElement('span');
        Object.assign(this.totalEl.style, {
            fontSize: '9px', color: '#555', fontFamily: '-apple-system, sans-serif',
            letterSpacing: '0.5px',
        });
        labelRow.append(label, this.totalEl);

        this.requestRowsEl = document.createElement('div');
        Object.assign(this.requestRowsEl.style, {
            display: 'flex', flexDirection: 'column', gap: '4px',
        });

        this.transportsSection.append(labelRow, this.requestRowsEl);

        // structures utilization section
        this.structuresSection = document.createElement('div');
        Object.assign(this.structuresSection.style, {
            display: 'flex', flexDirection: 'column', gap: '4px',
        });

        card.append(header, this.canvas, this.transportsSection, this.structuresSection);
        this.panel.appendChild(card);
        document.body.appendChild(this.panel);
        this.panel.addEventListener('click', e => { if (e.target === this.panel) this.toggle(); });

        // Record a chart data point every SAMPLE_MS (the chart's time resolution).
        this._sample();
        setInterval(() => this._sample(), SAMPLE_MS);
        // Refresh the on-screen panel once per REAL second while it's open. This is
        // wall-clock (setInterval), so the update rate is fixed at 1/sec regardless
        // of the game time multiplier.
        setInterval(() => { if (this.visible) this._refreshView(); }, 1000);
    }

    toggle(): void {
        this.visible = !this.visible;
        this.panel.style.display = this.visible ? 'flex' : 'none';
        if (this.visible) this._refreshView();
    }

    // Re-render every live section of the panel (job board, structure utilization,
    // and the throughput chart).
    private _refreshView(): void {
        this._renderRequests();
        this._renderStructures();
        this._render();
    }

    // ── Transport job market ──────────────────────────────────────────────────────

    // Per-request supply picture: how much a source can hand over right now, how
    // much inbound truck capacity is committed (reserved before pickup vs already
    // carried), and what's still unassigned.
    private _reqStats(req: TransportRequest): {
        available: number; reserved: number; inTransit: number; remaining: number;
    } {
        let reserved = 0, inTransit = 0;
        for (const t of this.transports) {
            if (t.servingRequest !== req) continue;
            const ph = t.jobPhase;
            if (ph === 'to_source' || ph === 'load')      reserved  += t.plannedPayloadKg;
            else if (ph === 'to_dest' || ph === 'unload') inTransit += t.plannedPayloadKg;
        }
        // Available for pickup: the source pickup buffer (natural deposit or
        // producer output), but only if a source structure actually exists.
        const src = resolveSource(req.resource, this.structures, req.destNormal);
        const available = src ? req.resource.deposit : 0;
        return { available, reserved, inTransit, remaining: req.remaining };
    }

    private _renderRequests(): void {
        const total = this.transports.length;
        const idle  = this.transports.filter(t => t.isIdle).length;
        this.totalEl.textContent = `${idle} idle / ${total} trucks`;

        this.requestRowsEl.innerHTML = '';
        const reqs = this.queue ? this.queue.requests.filter(r => !r.complete) : [];

        if (!reqs.length) {
            const empty = document.createElement('div');
            Object.assign(empty.style, {
                fontSize: '12px', color: '#555', padding: '8px 2px',
                fontFamily: '-apple-system, sans-serif',
            });
            empty.textContent = 'No open jobs — tap a structure to post a request.';
            this.requestRowsEl.appendChild(empty);
            return;
        }

        // Render as a dependency tree: roots first, each followed by the input
        // requests spawned to supply it. A child whose parent already completed
        // (dropped from `reqs`) is promoted to a root so it never disappears.
        const byId  = new Map(reqs.map(r => [r.id, r]));
        const roots = reqs.filter(r => r.parentId === undefined || !byId.has(r.parentId));
        const renderTree = (req: TransportRequest, depth: number): void => {
            this.requestRowsEl.appendChild(this._requestCard(req, depth));
            for (const child of reqs.filter(r => r.parentId === req.id)) renderTree(child, depth + 1);
        };
        for (const root of roots) renderTree(root, 0);
    }

    // One job-market row (card). `depth` > 0 = an auto-created input request,
    // indented under its parent to show the dependency.
    private _requestCard(req: TransportRequest, depth: number): HTMLElement {
        const carriers = this.transports.filter(t => t.servingRequest === req).length;
        const { available, reserved, inTransit, remaining } = this._reqStats(req);
        const pct = req.qtyRequested > 0
            ? Math.min(100, Math.round((req.qtyDelivered / req.qtyRequested) * 100))
            : 100;

        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'flex', flexDirection: 'column', gap: '6px',
            padding: '9px 12px', boxSizing: 'border-box', width: '100%',
            marginLeft: depth ? `${depth * 14}px` : '0',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderLeft: depth ? `2px solid ${req.resource.hex}` : '1px solid rgba(255,255,255,0.07)',
            borderRadius: '8px', fontFamily: '-apple-system, sans-serif',
        });

        // ── header: resource → dest, cancel (working-truck count is in the grid) ──
        const topRow = document.createElement('div');
        Object.assign(topRow.style, { display: 'flex', alignItems: 'center', gap: '8px' });

        const swatch = document.createElement('span');
        Object.assign(swatch.style, {
            width: '10px', height: '10px', borderRadius: '2px',
            background: req.resource.hex, flexShrink: '0',
        });

        const nameEl = document.createElement('span');
        nameEl.textContent = `${depth ? '↳ ' : ''}${req.resource.name} → ${req.destName}`;
        Object.assign(nameEl.style, { flex: '1', fontSize: '13px', color: '#ccc' });

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '✕';
        Object.assign(cancelBtn.style, {
            background: 'none', border: 'none', color: '#666',
            fontSize: '15px', cursor: 'pointer', padding: '0 2px', lineHeight: '1',
        });
        cancelBtn.title = 'Cancel request';
        cancelBtn.addEventListener('click', () => {
            this.cancelCallback(req);
            this.saveCallback();
            this._renderRequests();
        });

        topRow.append(swatch, nameEl, cancelBtn);

        // ── metrics grid: working / available / reserved / in transit / remaining ──
        // auto-fit lets the five cells wrap to a second line on narrow (phone) widths.
        const grid = document.createElement('div');
        Object.assign(grid.style, {
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(54px, 1fr))', gap: '4px',
        });
        const cell = (label: string, value: string, color: string) => {
            const c = document.createElement('div');
            Object.assign(c.style, { display: 'flex', flexDirection: 'column', gap: '1px' });
            const l = document.createElement('span');
            l.textContent = label;
            Object.assign(l.style, {
                fontSize: '8px', letterSpacing: '0.5px', textTransform: 'uppercase', color: '#555',
            });
            const v = document.createElement('span');
            v.textContent = value;
            Object.assign(v.style, { fontSize: '11px', color, fontWeight: '600' });
            c.append(l, v);
            return c;
        };
        // Available is amber when it can't cover what's still unfilled.
        const availColor = available >= remaining ? '#9ccc65' : '#ffb300';
        grid.append(
            cell('Working',   carriers > 0 ? `${carriers} 🚚` : '0', carriers > 0 ? '#ccc' : '#666'),
            cell('Avail',     formatScaled(available, 'kg'), availColor),
            cell('Reserved',  formatScaled(reserved, 'kg'),  '#9ecbff'),
            cell('In transit', formatScaled(inTransit, 'kg'), '#4dd0e1'),
            cell('Remaining', formatScaled(remaining, 'kg'), remaining > 0 ? '#ffc14d' : '#9ccc65'),
        );

        // ── progress bar (delivered / requested) ──
        const barTrack = document.createElement('div');
        Object.assign(barTrack.style, {
            height: '4px', borderRadius: '2px',
            background: 'rgba(255,255,255,0.08)', overflow: 'hidden',
        });
        const barFill = document.createElement('div');
        Object.assign(barFill.style, {
            height: '100%', width: `${pct}%`,
            background: req.resource.hex, borderRadius: '2px',
            transition: 'width 0.3s',
        });
        barTrack.appendChild(barFill);

        const progEl = document.createElement('div');
        progEl.textContent =
            `${formatScaled(req.qtyDelivered, 'kg')} / ${formatScaled(req.qtyRequested, 'kg')} delivered`;
        Object.assign(progEl.style, { fontSize: '10px', color: '#888' });

        row.append(topRow, grid, barTrack, progEl);
        return row;
    }

    // ── Structure utilization ─────────────────────────────────────────────────

    private _renderStructures(): void {
        this.structuresSection.innerHTML = '';

        // Only show built structures (Refinery, OilWell) — skip world nodes/homebase
        const built = this.structures.filter(
            s => s.label.startsWith('Refinery') || s.label === 'Oil Well',
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

            const topRow = document.createElement('div');
            Object.assign(topRow.style, { display: 'flex', alignItems: 'center', gap: '8px' });

            const nameEl = document.createElement('span');
            nameEl.textContent = `${s.label} #${idx}`;
            Object.assign(nameEl.style, { flex: '1', fontSize: '13px', color: '#ccc' });

            const pctEl = document.createElement('span');
            pctEl.textContent = `${pct}%`;
            Object.assign(pctEl.style, { fontSize: '13px', fontWeight: '600', color: barColor });

            topRow.append(nameEl, pctEl);

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

            if (limitedBy) {
                const limEl = document.createElement('div');
                limEl.textContent = `Limited by: ${limitedBy}`;
                Object.assign(limEl.style, { fontSize: '10px', color: '#888' });
                row.appendChild(limEl);
            }

            this.structuresSection.appendChild(row);
        }
    }

    // ── Sampling ──────────────────────────────────────────────────────────────

    private _sample(): void {
        const snap: Record<string, number> = {};
        for (const r of this.resources) snap[r.name] = r.gathered;
        this.history.push({ time: Date.now(), gathered: snap });
        if (this.history.length > MAX_SAMPLES) this.history.shift();
        // Rendering is handled by the 1/sec refresh timer; sampling only records data.
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

        const pad = { l: 56, r: 16, t: 14, b: 22, mid: 28 };
        const h1  = (H - pad.t - pad.b - pad.mid) / 2;
        const y1  = pad.t;
        const y2  = pad.t + h1 + pad.mid;

        this._drawSubChart(ctx, W, pad.l, pad.r, y1, h1, 'Accumulated',
            (i) => {
                const g = this.history[i].gathered;
                return this.resources.map(r => ({ name: r.name, color: r.hex, value: g[r.name] ?? 0 }));
            },
            (v) => formatScaled(v, 'kg'),
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
