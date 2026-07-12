import { Resource } from './resource';
import { Structure } from './structure';
import { Refinery } from './refinery';
import { PowerPlant, BATCH_KG_FUEL } from './powerPlant';

// Supply-chain primitives used by the engine's continuous re-provisioner
// (GameEngine.provisionSupply): find a resource's producer and the materials it
// consumes per unit of output. The engine turns any shortfall into child input
// requests each dispatch, so there is no separate one-shot tree builder.

// The structure that manufactures `resource`, if any (else it's a raw resource).
export function findProducer(resource: Resource, structures: Structure[]): Structure | null {
    for (const s of structures) {
        if (s instanceof Refinery   && s.recipe.outputName === resource.name) return s;
        if (s instanceof PowerPlant && s.providesResource === resource)       return s;
    }
    return null;
}

// Materials (+ fuel) a producer consumes to make `qty` of its output.
export function requiredInputs(
    producer: Structure,
    qty:      number,
    resources: Resource[],
): Array<{ res: Resource; kg: number }> {
    // Merge by resource so a material that's also the fuel (e.g. Coal) is one entry.
    const totals = new Map<Resource, number>();
    const add = (res: Resource | null | undefined, kg: number) => {
        if (res && kg > 0) totals.set(res, (totals.get(res) ?? 0) + kg);
    };

    if (producer instanceof Refinery) {
        const batches = Math.ceil(qty / producer.recipe.outputKgPerBatch);
        for (const spec of producer.recipe.fixedInputs) {
            add(resources.find(r => r.name === spec.resourceName), batches * spec.kgPerBatch);
        }
        add(producer.fuelResource, producer.fuelKgPerBatch() * batches);
    } else if (producer instanceof PowerPlant) {
        const batches = Math.ceil(qty / producer.kwhPerBatch);
        add(producer.fuelResource, batches * BATCH_KG_FUEL);
    }
    return [...totals].map(([res, kg]) => ({ res, kg }));
}
