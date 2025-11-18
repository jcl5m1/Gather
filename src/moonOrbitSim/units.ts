import {
    Measure,
    GenericMeasure,
    Length,
    Mass,
    Time,
    Velocity,
    Acceleration,
    Force,
    Energy,
    Power,
    Pressure,
    Temperature,
    Volume,
    Area,
    meters,
    grams,
    kilograms,
    seconds,
    minutes,
    hours,
    days,
    newtons,
    joules,
    watts,
    pascals,
    kelvin,
    kilo,
    Measure as MeasureType
} from 'safe-units';

// Create derived units using prefixes
export const kilometers = kilo(meters);
export const cubicMeters = meters.times(meters).times(meters);
export const squareMeters = meters.times(meters);
export const squareKilometers = kilometers.times(kilometers);

// Orbital mechanics unit constants (defined once for reuse)
export const cubicKilometers = kilometers.times(kilometers).times(kilometers);
export const secondsSquared = seconds.times(seconds);
export const kilometersPerSecond = kilometers.per(seconds);
export const squareKilometersPerSecondSquared = squareKilometers.per(secondsSquared);
export const cubicKilometersPerSecondSquared = cubicKilometers.per(secondsSquared);
// Gravitational constant unit: km³/(kg·s²)
export const gravitationalConstantUnit = cubicKilometers.per(kilograms.times(secondsSquared));

// For liters, we'll use a conversion factor (1 L = 0.001 m³)
const LITERS_TO_CUBIC_METERS = 0.001;
// We'll handle liter conversions manually when needed

// For celsius, we need to use kelvin with offset (safe-units doesn't have direct celsius)
// We'll handle temperature conversions manually when needed

// Re-export commonly used types and units
export {
    Measure,
    GenericMeasure,
    Length,
    Mass,
    Time,
    Velocity,
    Acceleration,
    Force,
    Energy,
    Power,
    Pressure,
    Temperature,
    Volume,
    Area,
    meters,
    grams,
    kilograms,
    seconds,
    minutes,
    hours,
    days,
    newtons,
    joules,
    watts,
    pascals,
    kelvin
};

// Define astronomical units (light-time units)
// Light-second: 299792.458 km (speed of light * 1 second)
const LIGHT_SPEED_KM_PER_S = 299792.458;
// Create light-second as a length unit (1 light-second = 299792.458 km)
// We'll create it as a measure that can be used as a unit reference
export const lightSecondUnit = Measure.of(LIGHT_SPEED_KM_PER_S, kilometers);
// For convenience, we'll use conversion functions rather than trying to create new unit types

// Helper functions to convert between units
export function kmToLightSeconds(km: number): number {
    return km / LIGHT_SPEED_KM_PER_S;
}

export function lightSecondsToKm(ls: number): number {
    return ls * LIGHT_SPEED_KM_PER_S;
}

// Helper to format distance with astronomical units if appropriate
// Picks the largest unit where the value is >= 0.5
export function formatDistanceWithAstronomicalUnits(length: Length): string {
    const kmValue = length.over(kilometers).value;
    const absKm = Math.abs(kmValue);
    
    // Light-day: 1 Ld = 2.59e10 km, >= 0.5 Ld means >= 1.295e10 km
    if (absKm >= 1.295e10) {
        const ldValue = kmValue / 2.59e10;
        return `${ldValue.toFixed(3)} Ld`;
    }
    // Light-hour: 1 Lh = 1.08e9 km, >= 0.5 Lh means >= 5.4e8 km
    if (absKm >= 5.4e8) {
        const lhValue = kmValue / 1.08e9;
        return `${lhValue.toFixed(3)} Lh`;
    }
    // Light-minute: 1 Lm = 1.8e7 km, >= 0.5 Lm means >= 9e6 km
    if (absKm >= 9e6) {
        const lmValue = kmValue / 1.8e7;
        return `${lmValue.toFixed(3)} Lm`;
    }
    // Light-second: 1 Ls = 299792.458 km, >= 0.5 Ls means >= 149896.229 km
    if (absKm >= 149896.229) {
        const lsValue = kmValue / LIGHT_SPEED_KM_PER_S;
        return `${lsValue.toFixed(3)} Ls`;
    }
    // km: >= 0.5 km
    if (absKm >= 0.5) {
        return `${kmValue.toFixed(3)} km`;
    }
    // m: 1 m = 0.001 km, >= 0.5 m means >= 0.0005 km
    if (absKm >= 0.0005) {
        return `${(kmValue * 1e3).toFixed(3)} m`;
    }
    // cm: 1 cm = 0.00001 km, >= 0.5 cm means >= 0.000005 km
    if (absKm >= 0.000005) {
        return `${(kmValue * 1e5).toFixed(3)} cm`;
    }
    // For very small values, use exponential notation with 3 decimals
    return `${kmValue.toExponential(3)} km`;
}

// Helper to format velocity (km/s is the base unit)
// Picks the largest unit where the value is >= 0.5
export function formatVelocity(velocity: Velocity): string {
    // Convert to km/s for display
    const kmPerS = velocity.over(kilometersPerSecond).value;
    const absKmPerS = Math.abs(kmPerS);
    
    // km/s: >= 0.5 km/s
    if (absKmPerS >= 0.5) {
        return `${kmPerS.toFixed(3)} km/s`;
    }
    // m/s: 1 m/s = 1e-3 km/s, >= 0.5 m/s means >= 0.0005 km/s
    if (absKmPerS >= 0.0005) {
        return `${(kmPerS * 1e3).toFixed(3)} m/s`;
    }
    // cm/s: 1 cm/s = 1e-5 km/s, >= 0.5 cm/s means >= 0.000005 km/s
    if (absKmPerS >= 0.000005) {
        return `${(kmPerS * 1e5).toFixed(3)} cm/s`;
    }
    // For very small values, use exponential notation with 3 decimals
    return `${kmPerS.toExponential(3)} km/s`;
}

// Helper to format time
// Picks the largest unit where the value is >= 0.5
export function formatTime(time: Time): string {
    if (!isFinite(time.value)) {
        return time.value === Infinity ? '∞' : 'NaN';
    }
    
    // Try days first: >= 0.5 d
    const daysValue = time.over(days).value;
    const absDays = Math.abs(daysValue);
    if (absDays >= 0.5) {
        return `${daysValue.toFixed(3)} d`;
    }
    
    // Try hours: 1 h = 1/24 d, >= 0.5 h means >= 0.5/24 d = 0.020833... d
    const hoursValue = time.over(hours).value;
    const absHours = Math.abs(hoursValue);
    if (absHours >= 0.5) {
        return `${hoursValue.toFixed(3)} h`;
    }
    
    // Try minutes: 1 min = 1/60 h, >= 0.5 min means >= 0.5/60 h = 0.008333... h
    const minutesValue = time.over(minutes).value;
    const absMinutes = Math.abs(minutesValue);
    if (absMinutes >= 0.5) {
        return `${minutesValue.toFixed(3)} min`;
    }
    
    // Try seconds: >= 0.5 s
    const secondsValue = time.over(seconds).value;
    const absSeconds = Math.abs(secondsValue);
    if (absSeconds >= 0.5) {
        return `${secondsValue.toFixed(3)} s`;
    }
    
    // For very small values, use exponential notation with 3 decimals
    return `${secondsValue.toExponential(3)} s`;
}

// Convenience constants for initializing measures
export const ZERO_LENGTH = Measure.of(0, kilometers);
export const ZERO_TIME = Measure.of(0, seconds);
export const ZERO_VELOCITY = Measure.of(0, kilometersPerSecond);
export const INFINITE_LENGTH = Measure.of(Infinity, kilometers);
export const INFINITE_TIME = Measure.of(Infinity, seconds);

// Helper to parse unit strings from config
export function parseUnit(unitString: string): any {
    const unitMap: { [key: string]: any } = {
        'km': kilometers,
        'm': meters,
        'kg': kilograms,
        'g': grams,
        's': seconds,
        'min': minutes,
        'h': hours,
        'd': days,
        'N': newtons,
        'J': joules,
        'W': watts,
        'Pa': pascals,
        'K': kelvin,
        'm³': cubicMeters,
        'm²': squareMeters,
        'km²': squareKilometers
    };
    
    return unitMap[unitString] || null;
}

// Helper to get unit string from a measure (for serialization)
export function getUnitString(measure: GenericMeasure<number, any, any>): string {
    // This is a simplified approach - safe-units doesn't directly expose unit names
    // We'll need to infer from the value and common patterns
    // For now, return a generic identifier
    return 'unit'; // This will be improved based on actual usage
}


