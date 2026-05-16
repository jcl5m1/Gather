// Top-center transient banners. Use for alerts like "out of fuel".
// Stacked vertically; each fades out after DURATION_MS.

const DURATION_MS = 3500;
const FADE_MS     = 400;

export class Notify {
    private container: HTMLDivElement;

    constructor() {
        this.container = document.createElement('div');
        Object.assign(this.container.style, {
            position:      'fixed',
            top:           '12px',
            left:          '50%',
            transform:     'translateX(-50%)',
            display:       'flex',
            flexDirection: 'column',
            gap:           '6px',
            alignItems:    'center',
            pointerEvents: 'none',
            zIndex:        '60',
        });
        document.body.appendChild(this.container);
    }

    show(text: string, color = '#ff6666'): void {
        const el = document.createElement('div');
        Object.assign(el.style, {
            background:   'rgba(0,0,0,0.78)',
            color,
            border:       `1px solid ${color}`,
            borderRadius: '6px',
            padding:      '6px 12px',
            fontSize:     '13px',
            fontWeight:   '600',
            fontFamily:   '-apple-system, sans-serif',
            opacity:      '1',
            whiteSpace:   'nowrap',
            textShadow:   '0 1px 2px rgba(0,0,0,0.6)',
            transition:   `opacity ${FADE_MS}ms ease-out`,
        });
        el.textContent = text;
        this.container.appendChild(el);

        setTimeout(() => { el.style.opacity = '0'; }, DURATION_MS);
        setTimeout(() => el.remove(),             DURATION_MS + FADE_MS + 50);
    }
}
