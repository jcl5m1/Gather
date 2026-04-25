export class Flash {
    private el: HTMLElement;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.el = document.getElementById('flash')!;
    }

    show(text: string, color: string, x: number, y: number): void {
        if (this.timer) clearTimeout(this.timer);
        Object.assign(this.el.style, {
            color,
            left:      `${x}px`,
            top:       `${y - 36}px`,
            transform: 'translateX(-50%)',
            transition: 'none',
            opacity:   '1',
        });
        this.el.textContent = text;
        this.timer = setTimeout(() => {
            this.el.style.transition = 'opacity 0.4s';
            this.el.style.opacity    = '0';
        }, 500);
    }
}
