// Generic status/warning board.
//
// Any subsystem can contribute a WarningSource — a function that inspects game
// state and returns the blocking issues it currently sees. The panel polls all
// sources, de-dupes by id, and renders a compact text list top-left. Warnings
// are stateful conditions (recomputed each refresh), not one-shot events: when a
// source stops reporting an id, that line disappears on its own.

export type WarningSeverity = 'error' | 'warn' | 'info';

export interface Warning {
    id:        string;          // stable key — dedupes and prevents flicker
    text:      string;
    severity?: WarningSeverity;  // defaults to 'warn'
    items?:    string[];         // specific blocked entities — shown when the chip is tapped
}

export type WarningSource = () => Warning[];

const SEVERITY_STYLE: Record<WarningSeverity, { color: string; border: string; icon: string }> = {
    error: { color: '#ff7676', border: 'rgba(255,80,80,0.5)',  icon: '⛔' },
    warn:  { color: '#ffc14d', border: 'rgba(255,180,0,0.45)', icon: '⚠' },
    info:  { color: '#9ecbff', border: 'rgba(120,170,255,0.4)', icon: 'ⓘ' },
};

export class WarningPanel {
    private el: HTMLElement;
    private sources: WarningSource[] = [];

    // Detail overlay (list of specific blocked items for a tapped warning).
    private detailOverlay: HTMLElement;
    private detailTitle!:  HTMLElement;
    private detailList!:   HTMLElement;

    constructor() {
        this.el = document.createElement('div');
        Object.assign(this.el.style, {
            position: 'fixed', top: '12px', left: '12px', zIndex: '35',
            display: 'none', flexDirection: 'column', gap: '6px',
            maxWidth: 'min(340px, 78vw)',
            // Container ignores taps; individual chips with details re-enable them.
            pointerEvents: 'none',
            fontFamily: '-apple-system, sans-serif',
        });
        document.body.appendChild(this.el);
        this.detailOverlay = this._makeDetailOverlay();
    }

    // Register a source. Sources are polled in registration order on refresh().
    addSource(fn: WarningSource): void { this.sources.push(fn); }

    // Poll every source, merge (first id wins), and re-render.
    refresh(): void {
        const merged = new Map<string, Warning>();
        for (const src of this.sources) {
            let list: Warning[];
            try { list = src(); } catch { continue; }
            for (const w of list) if (!merged.has(w.id)) merged.set(w.id, w);
        }
        this._render([...merged.values()]);
    }

    private _render(list: Warning[]): void {
        if (!list.length) { this.el.style.display = 'none'; this.el.innerHTML = ''; return; }
        // Errors first, then warnings, then info.
        const order: Record<WarningSeverity, number> = { error: 0, warn: 1, info: 2 };
        list.sort((a, b) => order[a.severity ?? 'warn'] - order[b.severity ?? 'warn']);

        this.el.innerHTML = '';
        for (const w of list) {
            const sev = w.severity ?? 'warn';
            const s   = SEVERITY_STYLE[sev];
            const chip = document.createElement('div');
            Object.assign(chip.style, {
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 10px',
                background: 'rgba(10,10,16,0.86)',
                border: `1px solid ${s.border}`,
                borderRadius: '8px',
                color: s.color, fontSize: '12px', lineHeight: '1.2',
            });
            const icon = document.createElement('span');
            icon.textContent = s.icon;
            icon.style.flexShrink = '0';
            const text = document.createElement('span');
            text.textContent = w.text;
            chip.append(icon, text);

            // Tappable when there are specific items to list.
            if (w.items && w.items.length) {
                chip.style.pointerEvents = 'auto';
                chip.style.cursor = 'pointer';
                const caret = document.createElement('span');
                caret.textContent = '›';
                Object.assign(caret.style, { marginLeft: 'auto', opacity: '0.7', flexShrink: '0' });
                chip.appendChild(caret);
                chip.addEventListener('click', () => this._showDetail(w));
            }

            this.el.appendChild(chip);
        }
        this.el.style.display = 'flex';
    }

    private _showDetail(w: Warning): void {
        this.detailTitle.textContent = w.text;
        this.detailList.innerHTML = '';
        for (const item of w.items ?? []) {
            const row = document.createElement('div');
            Object.assign(row.style, {
                padding: '8px 10px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px', color: '#ddd', fontSize: '13px',
            });
            row.textContent = item;
            this.detailList.appendChild(row);
        }
        this.detailOverlay.style.display = 'flex';
    }

    private _makeDetailOverlay(): HTMLElement {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '46',
            display: 'none', alignItems: 'center', justifyContent: 'center',
            fontFamily: '-apple-system, sans-serif',
        });

        const backdrop = document.createElement('div');
        Object.assign(backdrop.style, { position: 'absolute', inset: '0', background: 'rgba(0,0,0,0.6)' });
        backdrop.addEventListener('click', () => { overlay.style.display = 'none'; });

        const card = document.createElement('div');
        Object.assign(card.style, {
            position: 'relative', zIndex: '1',
            background: 'rgba(14,14,20,0.98)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px', padding: '20px',
            width: 'min(340px, 92vw)', maxHeight: '70vh',
            overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '10px',
        });

        const headerRow = document.createElement('div');
        Object.assign(headerRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' });
        this.detailTitle = document.createElement('div');
        Object.assign(this.detailTitle.style, {
            fontSize: '12px', fontWeight: '600', color: '#ddd', lineHeight: '1.3',
        });
        const closeX = document.createElement('button');
        closeX.textContent = '✕';
        Object.assign(closeX.style, {
            background: 'none', border: 'none', color: '#555',
            fontSize: '18px', cursor: 'pointer', padding: '0 2px', flexShrink: '0',
        });
        closeX.addEventListener('click', () => { overlay.style.display = 'none'; });
        headerRow.append(this.detailTitle, closeX);

        this.detailList = document.createElement('div');
        Object.assign(this.detailList.style, { display: 'flex', flexDirection: 'column', gap: '6px' });

        card.append(headerRow, this.detailList);
        overlay.append(backdrop, card);
        document.body.appendChild(overlay);
        return overlay;
    }
}
