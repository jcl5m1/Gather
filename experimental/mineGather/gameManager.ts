import { v4 as uuidv4 } from 'uuid';
import { GameState, Inventory, Mine, Resource, ResourceType } from './types';
import StorageManager from './storageManager';

export class GameManager {
    private gameState: GameState;
    private storageManager: StorageManager;
    private resources: Map<ResourceType, Resource>;
    private onStateChangeCallbacks: Array<(state: GameState) => void> = [];
    private regenerationInterval: number | null = null;

    /**
     * Static method to create and initialize a GameManager instance
     * This ensures the game state is fully loaded before the instance is used
     */
    public static async initialize(storageManager: StorageManager): Promise<GameManager> {
        const gameManager = new GameManager(storageManager);
        await gameManager.loadGameState();
        
        // Set up regeneration interval after state is loaded
        const boundRegenerateMines = gameManager.regenerateMines.bind(gameManager);
        gameManager.regenerationInterval = window.setInterval(boundRegenerateMines, 5000); // Check every 5 seconds
        
        console.log('Game state loaded successfully');
        return gameManager;
    }

    constructor(storageManager: StorageManager) {
        this.storageManager = storageManager;
        
        // Define resources
        this.resources = new Map<ResourceType, Resource>([
            [ResourceType.IRON, { 
                type: ResourceType.IRON, 
                name: 'Iron', 
                icon: '⚙️', 
                value: 1 
            }],
            [ResourceType.COPPER, { 
                type: ResourceType.COPPER, 
                name: 'Copper', 
                icon: '🔶', 
                value: 2 
            }],
            [ResourceType.GOLD, { 
                type: ResourceType.GOLD, 
                name: 'Gold', 
                icon: '💰', 
                value: 5 
            }],
            [ResourceType.DIAMOND, { 
                type: ResourceType.DIAMOND, 
                name: 'Diamond', 
                icon: '💎', 
                value: 10 
            }]
        ]);
        
        // Initialize with default state
        this.gameState = this.createDefaultGameState();
    }

    /**
     * Create a default game state
     */
    private createDefaultGameState(): GameState {
        return {
            inventory: {
                [ResourceType.IRON]: 0,
                [ResourceType.COPPER]: 0,
                [ResourceType.GOLD]: 0,
                [ResourceType.DIAMOND]: 0
            },
            mines: this.generateInitialMines(),
            lastSaved: Date.now()
        };
    }

    /**
     * Generate initial mines
     */
    private generateInitialMines(): Mine[] {
        const mines: Mine[] = [];
        const now = Date.now();
        
        // Create 3 mines for each resource type
        Object.values(ResourceType).forEach(resourceType => {
            for (let i = 0; i < 3; i++) {
                // Higher tier resources have lower capacity and longer regeneration
                let capacity = 0;
                let regenerationTime = 0;
                
                switch (resourceType) {
                    case ResourceType.IRON:
                        capacity = 10 + Math.floor(Math.random() * 10); // 10-19
                        regenerationTime = 10000; // 10 seconds
                        break;
                    case ResourceType.COPPER:
                        capacity = 7 + Math.floor(Math.random() * 7); // 7-13
                        regenerationTime = 15000; // 15 seconds
                        break;
                    case ResourceType.GOLD:
                        capacity = 4 + Math.floor(Math.random() * 4); // 4-7
                        regenerationTime = 30000; // 30 seconds
                        break;
                    case ResourceType.DIAMOND:
                        capacity = 2 + Math.floor(Math.random() * 3); // 2-4
                        regenerationTime = 60000; // 60 seconds
                        break;
                }
                
                mines.push({
                    id: uuidv4(),
                    resourceType: resourceType as ResourceType,
                    capacity,
                    remaining: capacity,
                    regenerationTime,
                    lastMined: now,
                    depleted: false
                });
            }
        });
        
        return mines;
    }

    /**
     * Load game state from storage
     */
    public async loadGameState(): Promise<void> {
        console.log('Loading game state...');
        try {
            const savedState = await this.storageManager.getInitialGameState();
            if (savedState) {
                console.log('Saved state found:', savedState);
                
                // Ensure all required properties exist in the saved state
                if (!savedState.mines || !savedState.inventory) {
                    console.warn('Saved state is missing required properties, using default state');
                    this.saveGameState();
                    return;
                }
                
                // Update the game state with the saved state
                this.gameState = savedState;
                
                // Ensure mine IDs are preserved and depleted status is correct
                this.gameState.mines.forEach(mine => {
                    mine.depleted = mine.remaining <= 0;
                });
                
                this.notifyStateChange();
                console.log('Game state loaded successfully');
            } else {
                console.log('No saved state found, using default state');
                // No saved state, use default and save it
                this.saveGameState();
            }
        } catch (error) {
            console.error('Error loading game state:', error);
            // If there's an error, use the default state
            this.saveGameState();
        }
    }

    /**
     * Save current game state
     */
    private saveGameState(): void {
        this.gameState.lastSaved = Date.now();
        this.storageManager.saveToLocalStorage(this.gameState);
    }

    /**
     * Mine a resource from a mine
     */
    public mineMine(mineId: string): boolean {
        const mine = this.gameState.mines.find(m => m.id === mineId);
        if (!mine || mine.depleted) return false;
        
        // Mine the resource
        const resourceAmount = Math.min(mine.remaining, 1);
        mine.remaining -= resourceAmount;
        mine.lastMined = Date.now();
        
        // Update depleted status
        mine.depleted = mine.remaining <= 0;
        
        // Add to inventory
        this.gameState.inventory[mine.resourceType] += resourceAmount;
        
        // Save and notify
        this.saveGameState();
        this.notifyStateChange();
        
        return true;
    }

    /**
     * Regenerate mines over time
     */
    private regenerateMines(): void {
        const now = Date.now();
        let changed = false;
        
        this.gameState.mines.forEach(mine => {
            if (mine.depleted || mine.remaining < mine.capacity) {
                const timeSinceLastMined = now - mine.lastMined;
                
                if (timeSinceLastMined >= mine.regenerationTime) {
                    // Regenerate one unit
                    mine.remaining = Math.min(mine.capacity, mine.remaining + 1);
                    mine.depleted = mine.remaining <= 0; // Ensure depleted status is correctly updated
                    mine.lastMined = now;
                    changed = true;
                    
                    // Log regeneration for debugging
                    console.log(`Mine ${mine.id} regenerated. New remaining: ${mine.remaining}, Depleted: ${mine.depleted}`);
                }
            }
        });
        
        if (changed) {
            this.saveGameState();
            this.notifyStateChange();
        }
    }

    /**
     * Register a callback for state changes
     */
    public onStateChange(callback: (state: GameState) => void): void {
        this.onStateChangeCallbacks.push(callback);
    }

    /**
     * Notify all registered callbacks of state change
     */
    private notifyStateChange(): void {
        this.onStateChangeCallbacks.forEach(callback => callback(this.gameState));
    }

    /**
     * Get the current game state
     */
    public getGameState(): GameState {
        return this.gameState;
    }

    /**
     * Get resource information
     */
    public getResources(): Map<ResourceType, Resource> {
        return this.resources;
    }

    /**
     * Get a specific resource
     */
    public getResource(type: ResourceType): Resource | undefined {
        return this.resources.get(type);
    }
}

export default GameManager;
