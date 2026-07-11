import { Vector3 } from 'three';
import { Transport, resolveSource } from './transport';
import { TransportQueue, TransportRequest } from './transportRequest';
import { Structure } from './structure';

// Status of an open request. null = actively being hauled (or dispatchable right
// now). The others are conditions worth surfacing:
//   no-source     — nothing can supply the resource (no producer, or depleted)
//   no-transport  — the fleet is empty; build a truck
//   no-fuel       — idle trucks exist but none can afford the trip's fuel
//   waiting       — trucks exist but all are busy elsewhere; it'll be served in turn
export type BlockReason = 'no-source' | 'no-transport' | 'no-fuel' | 'waiting';

// The source a request can be served from right now, or null if nothing in the
// world can supply it (no provider, or the provider's pickup buffer is empty).
// Depends only on the request + world — not on any truck — so callers resolve it
// once per request rather than per (truck × request).
function serviceableSource(req: TransportRequest, structures: Structure[]): Vector3 | null {
    const source = resolveSource(req.resource, structures, req.destNormal);
    return source && req.resource.inStock ? source : null;
}

// Why is `req` not making progress? Mirrors dispatch's own accept/reject checks
// (shared source resolution + per-truck affordability) so the diagnosis can't
// drift from the real assignment logic.
export function requestBlockReason(
    req:        TransportRequest,
    transports: Transport[],
    structures: Structure[],
): BlockReason | null {
    const source = serviceableSource(req, structures);
    if (!source)               return 'no-source';
    if (!transports.length)    return 'no-transport';
    if (req.qtyInFlight > 0)   return null;                     // already being hauled

    const idle = transports.filter(t => t.isIdle);
    if (!idle.length)          return 'waiting';                // fleet busy elsewhere
    // Idle trucks exist but none took it → the only remaining blocker is fuel.
    return idle.some(t => t.canAfford(source, req.destNormal)) ? null : 'no-fuel';
}

interface Job { req: TransportRequest; source: Vector3; }

// Greedily assign each idle transport to the open request it's best suited for,
// scored by outstanding-quantity ÷ estimated time-to-first-delivery (so a nearby
// truck with the right capacity and a large unmet request wins). Reservations
// (qtyInFlight) are updated as jobs are handed out, so the pool self-balances.
//
// Returns the number of transports newly dispatched.
export function dispatch(
    transports: Transport[],
    queue:      TransportQueue,
    structures: Structure[],
): number {
    if (!transports.some(t => t.isIdle)) return 0;

    // Resolve each open request's source once — it's the same for every truck.
    const jobs: Job[] = [];
    for (const req of queue.open()) {
        const source = serviceableSource(req, structures);
        if (source) jobs.push({ req, source });
    }
    if (!jobs.length) return 0;

    let assigned = 0;
    for (const t of transports) {
        if (!t.isIdle) continue;

        let best: Job | null = null;
        let bestScore = 0;
        for (const job of jobs) {
            // Skip requests already fully reserved by trucks assigned earlier in
            // this same pass (remaining updates as jobs are handed out).
            if (job.req.remaining <= 0) continue;
            if (!t.canAfford(job.source, job.req.destNormal)) continue;
            const score = job.req.remaining / (t.tripEtaSec(job.source, job.req.destNormal) + 1);
            if (!best || score > bestScore) { best = job; bestScore = score; }
        }

        if (best) { t.assignJob(best.req, best.source); assigned++; }
    }
    return assigned;
}
