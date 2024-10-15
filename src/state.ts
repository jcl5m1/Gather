// src/state.ts
import { RenderBody } from './renderbody';
import * as utils from './utils';

export let focusBody: RenderBody | null = null;
export let bodies: RenderBody[] = [];
export let time: number = 0;
export let inventory: { [key: string]: number } = {};


export enum Mode {
    Selection = 0,
    Build = 1,
    Transport = 2
}

export let mode: Mode = Mode.Selection;

export function init() {
    bodies = [];
    time = 0;
    let item = utils.getById('inventory', '1');
    item.then(data => {
        if (!data[0].inventory) {
            data[0].inventory = {};
        }
        inventory = data[0].inventory;
        console.log('Inventory data loaded:', inventory);
        utils.updateInventoryUI(inventory);
    }).catch(error => {
        console.error('Error fetching inventory data:', error);
        inventory = {};
    });



}
    
export function setFocusBody(body: RenderBody | null) {
    focusBody = body;
}

export function setMode(newMode: Mode) {
    mode = newMode;
    utils.setModeUI(Mode[mode]);
}

export function updateInventory(key: string, quantity: number) {
    if (inventory[key] === undefined) {
        inventory[key] = 0;
    }
    inventory[key] += quantity;
    utils.updateInventoryUI(inventory);
}


setInterval(async () => {

    const currentHost = `http://${window.location.hostname}:8010`;
    const table = 'inventory'; // Replace with your actual table name
    const userId = '1'; // Replace with your actual id

    let payload = {
        table: table,
        item: {
            id: userId,
            inventory: inventory,
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