export interface TechDef {
    id:          string;
    name:        string;
    description: string;
    cost:        Array<{ resourceName: string; amount: number }>;
    requires:    string[];
}

// Fuel upgrade chain — each tier unlocks a more energy-dense truck fuel.
// Wood (15 MJ/kg) < Coal (24) < Oil (42.7) < Gasoline (44.5)
export const TECH_DEFS: TechDef[] = [
    {
        id:          'fuel_coal',
        name:        'Coal Combustion',
        description: 'Trucks can burn coal instead of wood. 60% more energy-dense (24 MJ/kg vs 15).',
        cost: [
            { resourceName: 'Stone', amount: 10_000 },
            { resourceName: 'Iron',  amount:  2_000 },
        ],
        requires: [],
    },
    {
        id:          'fuel_oil',
        name:        'Diesel Engine',
        description: 'Trucks can burn crude oil. Nearly 3× the range of wood (42.7 MJ/kg).',
        cost: [
            { resourceName: 'Steel', amount: 5_000 },
            { resourceName: 'Iron',  amount: 5_000 },
        ],
        requires: ['fuel_coal'],
    },
    {
        id:          'fuel_gasoline',
        name:        'Gasoline Engine',
        description: 'Trucks can burn refined gasoline. Peak fuel efficiency (44.5 MJ/kg).',
        cost: [
            { resourceName: 'Steel', amount: 15_000 },
        ],
        requires: ['fuel_oil'],
    },
];

// Ordered lowest → highest grade; techId null = always unlocked
const FUEL_TIER: Array<{ name: string; techId: string | null }> = [
    { name: 'Wood',     techId: null },
    { name: 'Coal',     techId: 'fuel_coal' },
    { name: 'Oil',      techId: 'fuel_oil' },
    { name: 'Gasoline', techId: 'fuel_gasoline' },
];

export class TechTree {
    private researched = new Set<string>();

    isResearched(id: string): boolean { return this.researched.has(id); }

    canResearch(id: string): boolean {
        if (this.researched.has(id)) return false;
        const def = TECH_DEFS.find(t => t.id === id);
        if (!def) return false;
        return def.requires.every(r => this.researched.has(r));
    }

    research(id: string): void { this.researched.add(id); }

    unlockedFuelNames(): string[] {
        return FUEL_TIER
            .filter(f => f.techId === null || this.researched.has(f.techId))
            .map(f => f.name);
    }

    toJSON(): string[] { return [...this.researched]; }

    static fromJSON(ids: string[]): TechTree {
        const tt = new TechTree();
        for (const id of ids) tt.researched.add(id);
        return tt;
    }
}

export const TECH_TREE = new TechTree();
