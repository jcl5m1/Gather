import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/__tests__/**/*.test.ts'],
        // Three.js is shipped as ESM + CJS; let vitest resolve naturally.
        // No JSDOM — tests must avoid window/document/HTMLElement.
    },
});
