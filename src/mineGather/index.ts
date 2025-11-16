import StorageManager from './storageManager';
import GameManager from './gameManager';
import UIManager from './uiManager';

// Initialize the game
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Create managers
        const storageManager = new StorageManager();
        
        // Wait for IndexedDB to initialize
        await new Promise<void>((resolve) => {
            const checkDbReady = () => {
                if (storageManager.isDbInitialized()) {
                    resolve();
                } else {
                    setTimeout(checkDbReady, 100);
                }
            };
            checkDbReady();
        });
        
        // Initialize game manager and wait for game state to load
        const gameManager = await GameManager.initialize(storageManager);
        
        // Initialize UI after game state is loaded
        const uiManager = new UIManager(gameManager);

        console.log('MineGather game initialized successfully');
    } catch (error) {
        console.error('Error initializing game:', error);
    }
});
