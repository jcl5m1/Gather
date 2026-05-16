import { describe, it, expect } from 'vitest';
import { formatScaled } from '../resource';
import { splitTwoLines } from '../flash';

describe('formatScaled', () => {
    it('keeps small values in kg with 1 decimal', () => {
        expect(formatScaled(0, 'kg')).toBe('0.0 kg');
        expect(formatScaled(1, 'kg')).toBe('1.0 kg');
        expect(formatScaled(499, 'kg')).toBe('499.0 kg');
    });

    it('bumps to next prefix at 500 of current magnitude', () => {
        expect(formatScaled(500, 'kg')).toBe('0.5 Mg');
        expect(formatScaled(600, 'kg')).toBe('0.6 Mg');
        expect(formatScaled(1500, 'kg')).toBe('1.5 Mg');
    });

    it('chains prefixes through M / G / T / P', () => {
        expect(formatScaled(1_500_000,         'kg')).toBe('1.5 Gg');
        expect(formatScaled(1_500_000_000,     'kg')).toBe('1.5 Tg');
        expect(formatScaled(1_500_000_000_000, 'kg')).toBe('1.5 Pg');
    });

    it('handles kWh the same way', () => {
        expect(formatScaled(499,  'kWh')).toBe('499.0 kWh');
        expect(formatScaled(1500, 'kWh')).toBe('1.5 MWh');
        expect(formatScaled(1_500_000_000, 'kWh')).toBe('1.5 TWh');
    });

    it('handles negative magnitudes', () => {
        expect(formatScaled(-1500, 'kg')).toBe('-1.5 Mg');
    });
});

describe('splitTwoLines', () => {
    it('returns single-word phrase as-is', () => {
        expect(splitTwoLines('Hello')).toBe('Hello');
    });

    it('balances roughly-equal line lengths', () => {
        const out = splitTwoLines('Oil well must be placed over an oil deposit');
        const [a, b] = out.split('\n');
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        // Both halves non-empty and lengths within a few characters.
        expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(8);
    });

    it('splits at word boundaries only', () => {
        const out = splitTwoLines('one two three four');
        const lines = out.split('\n');
        for (const line of lines) {
            // no leading/trailing whitespace, words intact
            expect(line.trim()).toBe(line);
            expect(line.split(' ').every(w => w.length > 0)).toBe(true);
        }
    });
});
