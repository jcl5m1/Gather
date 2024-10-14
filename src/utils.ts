export let logDiv: HTMLDivElement;
export let inventoryDiv: HTMLDivElement;
export let modeDiv: HTMLDivElement;
export let hoverTextDiv: HTMLDivElement;
import { Resource } from './types/resource'; // Removed as Body is defined in the same file
export let resourceTable: Resource[] = [];

export function init(document: Document) {
    logDiv = document.createElement('div');
    logDiv.style.position = 'absolute';
    logDiv.style.top = '10px';
    logDiv.style.left = '10px';
    logDiv.style.color = 'white';
    logDiv.style.fontSize = '15px';
    logDiv.style.fontFamily = 'Arial';
    logDiv.innerText = `Console:`;
    document.body.appendChild(logDiv);

    modeDiv = document.createElement('div');
    modeDiv.style.position = 'absolute';
    modeDiv.style.top = '10px';
    modeDiv.style.right = '200px';
    modeDiv.style.color = 'white';
    modeDiv.style.fontSize = '15px';
    modeDiv.style.fontFamily = 'Arial';
    modeDiv.innerText = `Mode:`;
    document.body.appendChild(modeDiv);

    hoverTextDiv = document.createElement('div');
    hoverTextDiv.style.position = 'absolute';
    hoverTextDiv.style.top = '100px';
    hoverTextDiv.style.left = '100px';
    hoverTextDiv.style.color = 'white';
    hoverTextDiv.style.fontSize = '15px';
    hoverTextDiv.style.fontFamily = 'Arial';
    hoverTextDiv.innerText = `Hover:`;
    hoverTextDiv.style.display = 'none';
    document.body.appendChild(hoverTextDiv);

    inventoryDiv = document.createElement('div');
    inventoryDiv.style.position = 'absolute';
    inventoryDiv.style.top = '10px';
    inventoryDiv.style.right = '10px';
    inventoryDiv.style.color = 'white';
    inventoryDiv.style.fontSize = '15px';
    inventoryDiv.style.fontFamily = 'Arial';
    inventoryDiv.innerText = `Inventory:`;
    document.body.appendChild(inventoryDiv);
}

export function appendToLog(text: string) {

    if (!logDiv) {
        return;
    }

    console.log(text);
    const maxLines = 10;
    const lines = logDiv?.innerText ? logDiv.innerText.split('\n') : [];
    lines.push(text);
    if (lines.length > maxLines) {
        lines.splice(0, lines.length - maxLines);
    }
    logDiv.innerText = lines.join('\n');
}

export function setModeUI(mode: string) {
    if (!modeDiv) {
        return;
    }
    modeDiv.innerText = `Mode: ${mode}`;
}

export function updateInventoryUI(inventory: { [key: string]: number }) {
    if (!inventoryDiv) {
        return;
    }
    inventoryDiv.innerText = `Inventory:\n`;
    for (const key in inventory) {
        inventoryDiv.innerText += `${key}: ${inventory[key]}\n`;
    }
}

export async function getResourceById(id: string) {
    if (resourceTable.length === 0) {
        await getTable('resource').then(data => {
            data.forEach((item: any) => {
                const resource = new Resource(item);
                resourceTable.push(resource);
            });
            console.log('Resource table loaded:', resourceTable.length);
        }).catch(error => {
            console.error('Error fetching resource table:', error);
            resourceTable = [];
        });
    } 

    return resourceTable.find(resource => resource.id === id);

}

export const currentHost = `http://${window.location.hostname}:8010`;
export async function getById(table: string, id: string) {

    // use cached resource table
    if(table === 'resource') {
        return getResourceById(id);
    }

    // use cached body table?

    console.log(`Fetching ${table} with id ${id}`);
    return fetch(`${currentHost}/api?table=${table}&id=${id}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Error fetching ${table} with id ${id}: ${response.statusText}`);
            }
            return response.json();
        })
        .catch(error => {
            console.error(`Error fetching ${table}:`, error);
            throw error;
        });
}

export async function getTable(table: string) {
    return fetch(`${currentHost}/api?table=${table}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Error fetching ${table}: ${response.statusText}`);
            }
            return response.json();
        })
        .catch(error => {
            console.error(`Error fetching ${table}:`, error);
            throw error;
        });
}