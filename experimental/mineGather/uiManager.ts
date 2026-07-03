import { GameState, Mine, ResourceType } from './types';
import GameManager from './gameManager';

export class UIManager {
    private gameManager: GameManager;
    private minesContainer: HTMLElement;
    private resourcesDisplay: HTMLElement;
    private statusMessage: HTMLElement;

    constructor(gameManager: GameManager) {
        this.gameManager = gameManager;
        
        // Get DOM elements
        this.minesContainer = document.getElementById('minesContainer') as HTMLElement;
        this.resourcesDisplay = document.getElementById('resourcesDisplay') as HTMLElement;
        this.statusMessage = document.getElementById('statusMessage') as HTMLElement;
        
        // Register for state changes
        this.gameManager.onStateChange(this.updateUI.bind(this));
        
        // Initial UI update
        this.updateUI(this.gameManager.getGameState());
    }

    /**
     * Update the UI based on the current game state
     */
    public updateUI(gameState: GameState): void {
        this.updateResourcesDisplay(gameState);
        this.updateMinesDisplay(gameState);
    }

    /**
     * Update the resources display
     */
    private updateResourcesDisplay(gameState: GameState): void {
        // Clear current display
        this.resourcesDisplay.innerHTML = '';
        
        // Add each resource
        const resources = this.gameManager.getResources();
        resources.forEach((resource, type) => {
            const resourceElement = document.createElement('div');
            resourceElement.className = 'resource';
            resourceElement.innerHTML = `
                <div class="resource-icon">${resource.icon}</div>
                <div class="resource-name">${resource.name}</div>
                <div class="resource-count">${gameState.inventory[type]}</div>
            `;
            this.resourcesDisplay.appendChild(resourceElement);
        });
    }

    /**
     * Update the mines display
     */
    private updateMinesDisplay(gameState: GameState): void {
        // If mines container is empty, create all mines
        if (this.minesContainer.children.length === 0) {
            this.createMinesDisplay(gameState.mines);
        } else {
            // Otherwise just update the existing mines
            this.updateExistingMines(gameState.mines);
        }
    }

    /**
     * Create the initial mines display
     */
    private createMinesDisplay(mines: Mine[]): void {
        // Clear container
        this.minesContainer.innerHTML = '';
        
        // Create each mine element
        mines.forEach(mine => {
            const mineElement = this.createMineElement(mine);
            this.minesContainer.appendChild(mineElement);
        });
    }

    /**
     * Create a single mine element
     */
    private createMineElement(mine: Mine): HTMLElement {
        const resource = this.gameManager.getResource(mine.resourceType);
        if (!resource) throw new Error(`Resource not found for type: ${mine.resourceType}`);
        
        const mineElement = document.createElement('div');
        mineElement.className = `mine ${mine.depleted ? 'depleted' : ''}`;
        mineElement.dataset.id = mine.id;
        
        // Add content
        mineElement.innerHTML = `
            <div class="mine-icon">${resource.icon}</div>
            <div class="mine-resource">${resource.name}</div>
            <div class="mine-count">${mine.remaining}/${mine.capacity}</div>
        `;
        
        // Add click handler
        mineElement.addEventListener('click', () => this.handleMineClick(mine.id));
        
        return mineElement;
    }

    /**
     * Update existing mine elements
     */
    private updateExistingMines(mines: Mine[]): void {
        mines.forEach(mine => {
            const mineElement = this.minesContainer.querySelector(`[data-id="${mine.id}"]`) as HTMLElement;
            if (mineElement) {
                // Update depleted status
                if (mine.depleted) {
                    mineElement.classList.add('depleted');
                } else {
                    mineElement.classList.remove('depleted');
                }
                
                // Update resource count
                const countElement = mineElement.querySelector('.mine-count');
                if (countElement) {
                    countElement.textContent = `${mine.remaining}/${mine.capacity}`;
                }
            }
        });
    }

    /**
     * Handle mine click
     */
    private handleMineClick(mineId: string): void {
        const success = this.gameManager.mineMine(mineId);
        
        if (success) {
            const mine = this.gameManager.getGameState().mines.find(m => m.id === mineId);
            if (mine) {
                const resource = this.gameManager.getResource(mine.resourceType);
                if (resource) {
                    this.updateStatusMessage(`You mined 1 ${resource.name}!`);
                }
            }
        } else {
            // Improved error message
            const mine = this.gameManager.getGameState().mines.find(m => m.id === mineId);
            if (mine && mine.depleted) {
                const resource = this.gameManager.getResource(mine.resourceType);
                const resourceName = resource ? resource.name : 'resource';
                const regenerationTimeInSeconds = Math.round(mine.regenerationTime / 1000);
                this.updateStatusMessage(`This ${resourceName} mine is depleted. It will regenerate in about ${regenerationTimeInSeconds} seconds.`);
            } else {
                this.updateStatusMessage('Cannot mine at this time. Please try again later.');
            }
        }
    }

    /**
     * Update the status message
     */
    private updateStatusMessage(message: string): void {
        this.statusMessage.textContent = message;
        
        // Clear the message after 3 seconds
        setTimeout(() => {
            this.statusMessage.textContent = 'Click on mines to gather resources!';
        }, 3000);
    }
}

export default UIManager;
