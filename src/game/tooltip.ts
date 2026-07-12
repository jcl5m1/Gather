// Reusable floating tooltip pinned to screen coordinates.
// Caller composes DOM via setContent(); Tooltip handles base styling, viewport
// clamping, show/hide. Pointer-events disabled so it never blocks raycasts.

export class Tooltip {
    readonly el: HTMLElement;

    constructor() {
        this.el = document.createElement('div');
        Object.assign(this.el.style, {
            position:      'fixed',
            zIndex:        '60',
            pointerEvents: 'none',
            background:    'rgba(10,10,20,0.95)',
            border:        '1px solid rgba(255,255,255,0.12)',
            borderRadius:  '8px',
            padding:       '8px 10px',
            color:         '#ddd',
            font:          '12px -apple-system, sans-serif',
            display:       'none',
            maxWidth:      '280px',
            boxShadow:     '0 4px 12px rgba(0,0,0,0.5)',
        });
        document.body.appendChild(this.el);
    }

    setContent(node: Node): void {
        this.el.innerHTML = '';
        this.el.appendChild(node);
    }

    show(clientX: number, clientY: number): void {
        this.el.style.display = 'block';
        this.move(clientX, clientY);
    }

    move(clientX: number, clientY: number): void {
        const pad = 14;
        const w = this.el.offsetWidth, h = this.el.offsetHeight;
        let x = clientX + pad;
        let y = clientY + pad;
        if (x + w > window.innerWidth)  x = clientX - w - pad;
        if (y + h > window.innerHeight) y = clientY - h - pad;
        this.el.style.left = `${Math.max(0, x)}px`;
        this.el.style.top  = `${Math.max(0, y)}px`;
    }

    hide(): void {
        this.el.style.display = 'none';
    }

    get isVisible(): boolean {
        return this.el.style.display !== 'none';
    }

    dispose(): void {
        this.el.remove();
    }
}

// Helper: build a structured tooltip body with title, subtitle, and key/value rows.
export interface TooltipRow {
    label:  string;
    value?: string;
    swatch?: string;  // CSS color for a small color swatch before the label
}

export interface TooltipSection {
    label: string;         // e.g. 'Inputs', 'Output'
    rows:  TooltipRow[];
}

export interface CraftInfo {
    seconds:    number;    // crafting time for one batch
    progress01: number;    // current cycle progress [0,1]
}

function _sectionLabel(text: string): HTMLElement {
    const el = document.createElement('div');
    Object.assign(el.style, {
        fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
        color: '#777', margin: '6px 0 3px',
    });
    el.textContent = text;
    return el;
}

function _row(r: TooltipRow): HTMLElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '6px',
        fontSize: '11px', color: '#bbb',
    });
    if (r.swatch) {
        const sw = document.createElement('span');
        Object.assign(sw.style, {
            width: '8px', height: '8px', borderRadius: '2px',
            background: r.swatch, flexShrink: '0',
        });
        row.appendChild(sw);
    }
    const label = document.createElement('span');
    label.textContent = r.label;
    Object.assign(label.style, { flex: '1' });
    row.appendChild(label);
    if (r.value !== undefined) {
        const val = document.createElement('span');
        val.textContent = r.value;
        Object.assign(val.style, { color: '#eee', fontVariantNumeric: 'tabular-nums' });
        row.appendChild(val);
    }
    return row;
}

// Structure tooltip: title, type subtitle, one or more labelled sections
// (e.g. Inputs / Output), and an optional crafting time + progress bar.
export function buildStructureTooltip(
    title:    string,
    subtitle: string,
    sections: TooltipSection[],
    craft?:   CraftInfo,
): HTMLElement {
    const root = document.createElement('div');

    const titleEl = document.createElement('div');
    Object.assign(titleEl.style, { fontSize: '13px', fontWeight: '600', color: '#fff' });
    titleEl.textContent = title;
    root.appendChild(titleEl);

    if (subtitle) {
        const subEl = document.createElement('div');
        Object.assign(subEl.style, {
            fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase',
            color: '#888', marginBottom: '2px',
        });
        subEl.textContent = subtitle;
        root.appendChild(subEl);
    }

    for (const section of sections) {
        if (!section.rows.length) continue;
        root.appendChild(_sectionLabel(section.label));
        const rowsEl = document.createElement('div');
        Object.assign(rowsEl.style, { display: 'flex', flexDirection: 'column', gap: '2px' });
        for (const r of section.rows) rowsEl.appendChild(_row(r));
        root.appendChild(rowsEl);
    }

    if (craft) {
        root.appendChild(_sectionLabel('Crafting'));
        const timeRow = document.createElement('div');
        Object.assign(timeRow.style, {
            display: 'flex', justifyContent: 'space-between',
            fontSize: '11px', color: '#bbb', marginBottom: '3px',
        });
        const lbl = document.createElement('span'); lbl.textContent = 'per batch';
        const val = document.createElement('span');
        val.textContent = `${craft.seconds}s`;
        Object.assign(val.style, { color: '#eee', fontVariantNumeric: 'tabular-nums' });
        timeRow.append(lbl, val);
        root.appendChild(timeRow);

        const track = document.createElement('div');
        Object.assign(track.style, {
            height: '5px', borderRadius: '3px',
            background: 'rgba(255,255,255,0.10)', overflow: 'hidden',
        });
        const fill = document.createElement('div');
        const pct = Math.round(Math.max(0, Math.min(1, craft.progress01)) * 100);
        Object.assign(fill.style, {
            height: '100%', width: `${pct}%`,
            background: '#4caf50', borderRadius: '3px',
        });
        track.appendChild(fill);
        root.appendChild(track);
    }

    return root;
}

export function buildTooltipBody(title: string, subtitle: string, rows: TooltipRow[]): HTMLElement {
    const root = document.createElement('div');

    const titleEl = document.createElement('div');
    Object.assign(titleEl.style, {
        fontSize:   '13px',
        fontWeight: '600',
        color:      '#fff',
        marginBottom: '2px',
    });
    titleEl.textContent = title;
    root.appendChild(titleEl);

    if (subtitle) {
        const subEl = document.createElement('div');
        Object.assign(subEl.style, {
            fontSize:       '9px',
            letterSpacing:  '1.5px',
            textTransform:  'uppercase',
            color:          '#888',
            marginBottom:   '6px',
        });
        subEl.textContent = subtitle;
        root.appendChild(subEl);
    }

    if (rows.length) {
        const rowsEl = document.createElement('div');
        Object.assign(rowsEl.style, { display: 'flex', flexDirection: 'column', gap: '2px' });
        for (const r of rows) {
            const row = document.createElement('div');
            Object.assign(row.style, {
                display:    'flex',
                alignItems: 'center',
                gap:        '6px',
                fontSize:   '11px',
                color:      '#bbb',
            });
            if (r.swatch) {
                const sw = document.createElement('span');
                Object.assign(sw.style, {
                    width: '8px', height: '8px', borderRadius: '2px',
                    background: r.swatch, flexShrink: '0',
                });
                row.appendChild(sw);
            }
            const label = document.createElement('span');
            label.textContent = r.label;
            Object.assign(label.style, { flex: '1' });
            row.appendChild(label);
            if (r.value !== undefined) {
                const val = document.createElement('span');
                val.textContent = r.value;
                Object.assign(val.style, { color: '#eee', fontVariantNumeric: 'tabular-nums' });
                row.appendChild(val);
            }
            rowsEl.appendChild(row);
        }
        root.appendChild(rowsEl);
    }

    return root;
}
