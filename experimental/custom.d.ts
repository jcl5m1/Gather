// src/custom.d.ts
declare var module: {
    hot?: {
        accept(callback?: () => void): void;
    };
};