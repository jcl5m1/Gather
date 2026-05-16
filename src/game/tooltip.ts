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
