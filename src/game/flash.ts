// Per-tap "+N kg X" labels. Each call spawns its own DOM node so multiple
// rapid taps stack visibly. Each label rises 40 px and fades to zero over `durationMs`.
// Multi-line text uses '\n' separators in the input string.

const RISE_PX = 40;

export class Flash {
    show(text: string, color: string, x: number, y: number, durationMs = 1000): void {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position:      'fixed',
            left:          `${x}px`,
            top:           `${y - 36}px`,
            transform:     'translate(-50%, 0)',
            color,
            fontSize:      '15px',
            fontWeight:    '600',
            fontFamily:    '-apple-system, sans-serif',
            whiteSpace:    'pre',       // honour '\n' line breaks
            textAlign:     'center',
            pointerEvents: 'none',
            opacity:       '1',
            textShadow:    '0 1px 2px rgba(0,0,0,0.7)',
            zIndex:        '55',
            lineHeight:    '1.25',
        });
        el.textContent = text;
        document.body.appendChild(el);

        // Force layout so the transition picks up the initial state.
        void el.offsetHeight;

        el.style.transition = `transform ${durationMs}ms ease-out, opacity ${durationMs}ms ease-out`;
        el.style.transform  = `translate(-50%, -${RISE_PX}px)`;
        el.style.opacity    = '0';

        setTimeout(() => el.remove(), durationMs + 50);
    }
}

// Wrap a phrase into two lines split at the word boundary closest to balancing
// line lengths (in characters).
export function splitTwoLines(s: string): string {
    const words = s.split(/\s+/);
    if (words.length < 2) return s;
    let bestI = 1, bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
        const left  = words.slice(0, i).join(' ').length;
        const right = words.slice(i).join(' ').length;
        const diff  = Math.abs(left - right);
        if (diff < bestDiff) { bestDiff = diff; bestI = i; }
    }
    return words.slice(0, bestI).join(' ') + '\n' + words.slice(bestI).join(' ');
}
