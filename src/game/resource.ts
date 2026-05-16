import { Mesh } from 'three';

// SI-prefix scaling for any base unit beginning with 'k' (kg, kWh).
// Replaces the leading 'k' with progressively larger prefixes. 1 decimal place.
// Bumps to next prefix when value exceeds 500 of current magnitude.
//   499 kg  → "499.0 kg"
//   600 kg  → "0.6 Mg"
//   1500 kg → "1.5 Mg"
//   600 kWh → "0.6 MWh"
const _SI_PREFIXES = ['k', 'M', 'G', 'T', 'P', 'E'];
export function formatScaled(n: number, baseUnit: string): string {
    const tail = baseUnit.startsWith('k') ? baseUnit.slice(1) : baseUnit;
    let i = 0;
    let v = n;
    while (Math.abs(v) >= 500 && i < _SI_PREFIXES.length - 1) {
        v /= 1000;
        i++;
    }
    return `${v.toFixed(1)} ${_SI_PREFIXES[i]}${tail}`;
}

// Default natural deposit (kg) for new resources. 10 Gg = 1e7 kg.
export const DEFAULT_DEPOSIT_KG = 10_000_000;

export class Resource {
    readonly name:               string;
    readonly color:              number;
    readonly depositInitial:     number;    // kg of natural deposit at full (0 for manufactured)
    readonly gatherAmount:       number;    // kg per manual tap
    readonly isFuel:             boolean;
    readonly energyDensityMJkg:  number;   // MJ/kg lower heating value (0 for non-fuels)
    readonly isManufactured:     boolean;  // true = no pad on map; produced by structures
    readonly unit:               string;   // 'kg' for most resources, 'kWh' for Electricity
    readonly requiresExtraction: boolean;  // true = ResourceNode (raw pad) is not a truck source; must build dedicated extractor
    deposit:  number;                       // kg remaining in natural deposit
    gathered = 0;                           // inventory held
    mesh:    Mesh | null = null;
    hitMesh: Mesh | null = null;

    constructor(
        name:              string,
        color:             number,
        depositInitial    = DEFAULT_DEPOSIT_KG,
        gatherAmount      = 1_000,
        isFuel             = false,
        energyDensityMJkg  = 0,
        isManufactured     = false,
        unit               = 'kg',
        requiresExtraction = false,
    ) {
        this.name              = name;
        this.color             = color;
        this.depositInitial    = isManufactured ? 0 : depositInitial;
        this.gatherAmount      = gatherAmount;
        this.isFuel            = isFuel;
        this.energyDensityMJkg = energyDensityMJkg;
        this.isManufactured    = isManufactured;
        this.unit              = unit;
        this.requiresExtraction = requiresExtraction;
        this.deposit           = this.depositInitial;
    }

    // Manual tap or truck pickup. Debits deposit (natural resources only).
    // Returns false when deposit empty so caller can stop the truck / show feedback.
    gather(amount = this.gatherAmount): boolean {
        if (this.isManufactured) {
            this.gathered += amount;
            return true;
        }
        if (this.deposit <= 0) return false;
        const take = Math.min(amount, this.deposit);
        this.deposit  -= take;
        this.gathered += take;
        return true;
    }

    // Manufactured / refined output — never touches a natural deposit.
    produce(amount: number): void {
        this.gathered += amount;
    }

    consume(kg: number): boolean {
        if (this.gathered < kg) return false;
        this.gathered -= kg;
        return true;
    }

    get hex(): string {
        return '#' + this.color.toString(16).padStart(6, '0');
    }

    get displayAmount(): string {
        return formatScaled(this.gathered, this.unit);
    }
}

//                                name       color      deposit(kg)   tap  isFuel  MJ/kg  mfg?   unit
export const RESOURCES: Resource[] = [
    new Resource('Wood',      0x8B5E3C, DEFAULT_DEPOSIT_KG, 1_000, true,  15.0),
    new Resource('Stone',     0x9E9E9E, DEFAULT_DEPOSIT_KG, 1_000),
    new Resource('Iron',      0xB0BEC5, DEFAULT_DEPOSIT_KG, 1_000),
    new Resource('Coal',      0x455A64, DEFAULT_DEPOSIT_KG, 1_000, true,  24.0),
    new Resource('Crystal',   0x00BCD4, DEFAULT_DEPOSIT_KG, 1_000),
    new Resource('Steel',     0x90a4ae, 0, 0, false,  0,    true),
    new Resource('Oil',       0x3e2723, DEFAULT_DEPOSIT_KG, 0, true,  42.7, false, 'kg', true),
    new Resource('Gasoline',  0xFFD700, 0, 0, true, 44.5, true),
    new Resource('Electricity', 0xFDD835, 0, 0, false, 0, true, 'kWh'),
];
