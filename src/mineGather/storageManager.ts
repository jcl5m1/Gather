import { GameState, Inventory, ResourceType } from './types';

// Local storage key
const STORAGE_KEY = 'mineGather_gameState';

// IndexedDB database name and version
const DB_NAME = 'MineGatherDB';
const DB_VERSION = 1;
const STORE_NAME = 'gameState';

export class StorageManager {
    private db: IDBDatabase | null = null;
    private isOnline: boolean = navigator.onLine;
    private pendingChanges: boolean = false;
    private syncInterval: number | null = null;
    private dbInitialized: boolean = false;

    constructor() {
        // Initialize IndexedDB
        this.initIndexedDB();

        // Set up online/offline event listeners
        window.addEventListener('online', this.handleOnlineStatusChange.bind(this));
        window.addEventListener('offline', this.handleOnlineStatusChange.bind(this));
    }
    
    /**
     * Check if IndexedDB is initialized
     */
    public isDbInitialized(): boolean {
        return this.dbInitialized;
    }

    /**
     * Initialize IndexedDB
     */
    private initIndexedDB(): void {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('IndexedDB error:', event);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => {
            this.db = (event.target as IDBOpenDBRequest).result;
            console.log('IndexedDB initialized successfully');
            
            // Mark as initialized
            this.dbInitialized = true;
            
            // Start sync interval if online
            if (this.isOnline) {
                this.startSyncInterval();
            }
        };
    }

    /**
     * Handle online/offline status changes
     */
    private handleOnlineStatusChange(): void {
        const wasOnline = this.isOnline;
        this.isOnline = navigator.onLine;
        
        // Update UI to show online/offline status
        const offlineIndicator = document.getElementById('offlineIndicator');
        if (offlineIndicator) {
            if (this.isOnline) {
                offlineIndicator.classList.remove('visible');
                // If we were offline and now online, sync changes
                if (!wasOnline && this.pendingChanges) {
                    this.syncWithServer();
                }
                this.startSyncInterval();
            } else {
                offlineIndicator.classList.add('visible');
                this.stopSyncInterval();
            }
        }
    }

    /**
     * Start the sync interval
     */
    private startSyncInterval(): void {
        if (this.syncInterval === null) {
            this.syncInterval = window.setInterval(() => {
                if (this.pendingChanges) {
                    this.syncWithServer();
                }
            }, 30000); // Sync every 30 seconds if there are changes
        }
    }

    /**
     * Stop the sync interval
     */
    private stopSyncInterval(): void {
        if (this.syncInterval !== null) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    /**
     * Sync local changes with the server
     * In a real app, this would make API calls to a backend
     */
    private syncWithServer(): void {
        if (!this.isOnline) return;

        // In a real app, this would be an API call
        // For this demo, we'll just simulate a successful sync
        console.log('Syncing with server...');
        
        // Get the latest state from local storage
        const gameState = this.loadFromLocalStorage();
        if (gameState) {
            // Simulate server sync
            setTimeout(() => {
                console.log('Sync complete');
                this.pendingChanges = false;
                // Update last saved timestamp
                gameState.lastSaved = Date.now();
                this.saveToLocalStorage(gameState);
            }, 500);
        }
    }

    /**
     * Save game state to local storage
     */
    public saveToLocalStorage(gameState: GameState): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
            this.pendingChanges = true;
            
            // Also save to IndexedDB for offline support
            this.saveToIndexedDB(gameState);
            
            // If online, sync with server
            if (this.isOnline) {
                this.syncWithServer();
            }
        } catch (error) {
            console.error('Error saving to local storage:', error);
        }
    }

    /**
     * Load game state from local storage
     */
    public loadFromLocalStorage(): GameState | null {
        try {
            const savedState = localStorage.getItem(STORAGE_KEY);
            if (savedState) {
                return JSON.parse(savedState) as GameState;
            }
        } catch (error) {
            console.error('Error loading from local storage:', error);
        }
        return null;
    }

    /**
     * Save game state to IndexedDB
     */
    private saveToIndexedDB(gameState: GameState): void {
        if (!this.db) return;

        try {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            // Use a fixed ID for the game state
            const stateWithId = { ...gameState, id: 'currentState' };
            store.put(stateWithId);
            
            transaction.oncomplete = () => {
                console.log('Game state saved to IndexedDB');
            };
            
            transaction.onerror = (event) => {
                console.error('Error saving to IndexedDB:', event);
            };
        } catch (error) {
            console.error('Error accessing IndexedDB:', error);
        }
    }

    /**
     * Load game state from IndexedDB
     * Returns a promise that resolves to the game state or null
     */
    public loadFromIndexedDB(): Promise<GameState | null> {
        return new Promise((resolve) => {
            if (!this.db) {
                resolve(null);
                return;
            }

            try {
                const transaction = this.db.transaction([STORE_NAME], 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.get('currentState');
                
                request.onsuccess = () => {
                    if (request.result) {
                        // Remove the ID field we added for IndexedDB
                        const { id, ...gameState } = request.result;
                        resolve(gameState as GameState);
                    } else {
                        resolve(null);
                    }
                };
                
                request.onerror = () => {
                    console.error('Error loading from IndexedDB');
                    resolve(null);
                };
            } catch (error) {
                console.error('Error accessing IndexedDB:', error);
                resolve(null);
            }
        });
    }

    /**
     * Get the initial game state, trying local storage first, then IndexedDB
     */
    public async getInitialGameState(): Promise<GameState | null> {
        // Try local storage first (faster)
        const localState = this.loadFromLocalStorage();
        if (localState) return localState;
        
        // If not in local storage, try IndexedDB
        return await this.loadFromIndexedDB();
    }

    /**
     * Check if the user is online
     */
    public isUserOnline(): boolean {
        return this.isOnline;
    }
}

export default StorageManager;
