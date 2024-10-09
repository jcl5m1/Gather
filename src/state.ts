// src/state.ts
import { Body } from './body';

export let focusBody: Body | null = null;
export let bodies: Body[] = [];

export function setFocusBody(body: Body | null) {
    focusBody = body;
}