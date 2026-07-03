// src/state.ts
import { RenderBody } from './renderbody';
import * as utils from './utils';
import * as THREE from 'three';

export let focusBody: RenderBody | null = null;
export let bodies: RenderBody[] = [];
export let time: number = 0;
export let playerInventory: { [key: string]: number } = {};
export let playerInventoryId: string = '1';

export enum Mode {
    Selection = 0,
    Build = 1,
    Transport = 2
}

export let mode: Mode = Mode.Selection;

export function init() {
    bodies = [];
    time = 0;
    let item = utils.getById('inventory', playerInventoryId);
    item.then(data => {
        if (!data[0].inventory) {
            data[0].inventory = {};
        }
        playerInventory = data[0].inventory;
        console.log('Player Inventory data loaded:', playerInventory);
        utils.updateInventoryUI(playerInventory);
    }).catch(error => {
        console.error('Error fetching inventory data:', error);
        playerInventory = {};
    });



}
    
export function setFocusBody(body: RenderBody | null) {
    focusBody = body;
}

export function setMode(newMode: Mode) {
    mode = newMode;
    utils.setModeUI(Mode[mode]);
}

export function buildFactory(parent: RenderBody, intersection: THREE.Intersection) {
    //insert new factory into bodies

}

export function updateInventory(key: string, quantity: number) {
    if (playerInventory[key] === undefined) {
        playerInventory[key] = 0;
    }
    playerInventory[key] += quantity;
    utils.updateInventoryUI(playerInventory);
}

//autosave inventory every minute
setInterval(async () => {
    return;
    const currentHost = `http://${window.location.hostname}:8010`;
    const table = 'inventory'; // Replace with your actual table name
    const userId = playerInventoryId;

    let payload = {
        table: table,
        item: {
            id: userId,
            inventory: playerInventory,
        }
    };

    try {
        const response = await fetch(`${currentHost}/api`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data = await response.json();
        console.log('Inventory updated successfully:', data);
    } catch (error) {
        console.error('Failed to update inventory:', error);
    }
}, 60000); // 60000 milliseconds = 1 minute