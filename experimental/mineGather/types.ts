// Resource types available in the game
export enum ResourceType {
    IRON = 'iron',
    COPPER = 'copper',
    GOLD = 'gold',
    DIAMOND = 'diamond'
}

// Resource data structure
export interface Resource {
    type: ResourceType;
    name: string;
    icon: string;
    value: number;
}

// Mine data structure
export interface Mine {
    id: string;
    resourceType: ResourceType;
    capacity: number;
    remaining: number;
    regenerationTime: number; // in milliseconds
    lastMined: number; // timestamp
    depleted: boolean;
}

// Player's inventory
export interface Inventory {
    [ResourceType.IRON]: number;
    [ResourceType.COPPER]: number;
    [ResourceType.GOLD]: number;
    [ResourceType.DIAMOND]: number;
}

// Game state
export interface GameState {
    inventory: Inventory;
    mines: Mine[];
    lastSaved: number; // timestamp
}
