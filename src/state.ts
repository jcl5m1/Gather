// src/state.ts
import { Body } from './body';

export let focusBody: Body | null = null;
export let bodies: Body[] = [];
export let time: number = 0;
export let resources: { [key: string]: number } = {};


export function init() {
    bodies = [];
    time = 0;
    resources = {};
}
    
export function setFocusBody(body: Body | null) {
    focusBody = body;
}

export function adjustResource(key: string, quantity: number) {
    if (resources[key] === undefined) {
        resources[key] = 0;
    }
    resources[key] += quantity;
}