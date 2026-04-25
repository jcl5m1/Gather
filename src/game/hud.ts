import { Resource } from './resource';

export class HUD {
    private slotEls  = new Map<string, HTMLElement>();
    private countEls = new Map<string, HTMLElement>();
    private titleEl: HTMLElement;

    constructor(resources: Resource[]) {
        const hud   = document.getElementById('hud')!;
        const slots = document.getElementById('hud-slots')!;

        this.titleEl = document.createElement('div');
        this.titleEl.id = 'hud-title';
        this.titleEl.textContent = 'Homebase';
        hud.insertBefore(this.titleEl, slots);

        for (const res of resources) {
            const slot   = document.createElement('div');
            slot.className = 'slot';
            const swatch = document.createElement('div');
            swatch.className = 'slot-swatch';
            swatch.style.background = res.hex;
            const name   = document.createElement('div');
            name.className = 'slot-name';
            name.textContent = res.name;
            const count  = document.createElement('div');
            count.className = 'slot-count';
            count.textContent = '0';
            slot.append(swatch, name, count);
            slots.appendChild(slot);
            this.slotEls.set(res.name, slot);
            this.countEls.set(res.name, count);
        }
    }

    update(res: Resource): void {
        const el = this.countEls.get(res.name);
        if (el) el.textContent = res.displayAmount;
    }

    refreshAll(resources: Resource[]): void {
        for (const r of resources) this.update(r);
    }

    showHomebase(): void {
        this.titleEl.textContent = 'Homebase';
        for (const slot of this.slotEls.values()) slot.style.display = 'flex';
    }

    showContext(title: string, visibleNames: string[]): void {
        this.titleEl.textContent = title;
        for (const [name, slot] of this.slotEls) {
            slot.style.display = visibleNames.includes(name) ? 'flex' : 'none';
        }
    }
}
