import { Resource, formatScaled } from './resource';
import { TECH_DEFS, TechTree } from './tech';

export class TechPanel {
    private panel:   HTMLElement;
    private content: HTMLElement;
    private isOpen        = false;
    private lastRefreshMs = 0;

    // Performs the research through the engine (spend + unlock). Returns false if
    // it couldn't be researched. Default no-op until wired from index.
    private researchHandler: (techId: string) => boolean = () => false;

    constructor(
        private resources:    Resource[],
        private techTree:     TechTree,
        private onResearched: () => void,
    ) {
        this.panel   = document.getElementById('tech-panel')!;
        this.content = document.getElementById('tech-panel-content')!;
        document.getElementById('tp-close')!.addEventListener('click', () => this.close());
    }

    setResearchHandler(fn: (techId: string) => boolean): void { this.researchHandler = fn; }

    toggle(): void { this.isOpen ? this.close() : this.open(); }

    open(): void {
        this.isOpen        = true;
        this.lastRefreshMs = Date.now();
        this._refresh();
        this.panel.classList.remove('bm-hidden');
    }

    close(): void {
        this.isOpen = false;
        this.panel.classList.add('bm-hidden');
    }

    tick(): void {
        if (!this.isOpen) return;
        const now = Date.now();
        if (now - this.lastRefreshMs > 2000) {
            this.lastRefreshMs = now;
            this._refresh();
        }
    }

    private _refresh(): void {
        this.content.innerHTML = '';
        const fmt = (n: number) => formatScaled(n, 'kg');

        for (const def of TECH_DEFS) {
            const researched  = this.techTree.isResearched(def.id);
            const canResearch = this.techTree.canResearch(def.id);
            const canAfford   = def.cost.every(c => {
                const r = this.resources.find(x => x.name === c.resourceName);
                return r !== undefined && r.gathered >= c.amount;
            });

            const card = document.createElement('div');
            card.className = 'tp-card' +
                (researched ? ' tp-done' : canResearch ? '' : ' tp-locked');

            const nameEl = document.createElement('div');
            nameEl.className   = 'tp-name';
            nameEl.textContent = def.name;

            const descEl = document.createElement('div');
            descEl.className   = 'tp-desc';
            descEl.textContent = def.description;

            card.append(nameEl, descEl);

            if (!researched) {
                const costEl = document.createElement('div');
                costEl.className   = 'tp-cost';
                costEl.textContent = def.cost.map(c => {
                    const r    = this.resources.find(x => x.name === c.resourceName);
                    const have = r ? r.gathered : 0;
                    return `${fmt(have)} / ${fmt(c.amount)} ${c.resourceName}`;
                }).join('  ·  ');
                costEl.style.color = canAfford ? '#8fbc8f' : '#bc8f8f';
                card.appendChild(costEl);
            }

            if (researched) {
                const badge = document.createElement('div');
                badge.className   = 'tp-badge';
                badge.textContent = '✓ Researched';
                card.appendChild(badge);
            } else if (!canResearch) {
                const reqNames = def.requires
                    .map(rid => TECH_DEFS.find(t => t.id === rid)?.name ?? rid)
                    .join(', ');
                const badge = document.createElement('div');
                badge.className   = 'tp-badge tp-badge-locked';
                badge.textContent = `Requires: ${reqNames}`;
                card.appendChild(badge);
            } else {
                const btn = document.createElement('button');
                btn.className     = 'bm-build-btn';
                btn.textContent   = 'Research';
                btn.disabled      = !canAfford;
                btn.style.opacity = canAfford ? '1' : '0.45';
                if (canAfford) {
                    btn.addEventListener('click', () => {
                        // Spend + unlock happens in the engine (authoritative + logged).
                        if (this.researchHandler(def.id)) {
                            this.onResearched();
                            this._refresh();
                        }
                    });
                }
                card.appendChild(btn);
            }

            this.content.appendChild(card);
        }
    }
}
