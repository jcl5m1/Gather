import { Vector3 } from 'three';
import { Resource } from './resource';

// ─── Transport request ──────────────────────────────────────────────────────
// A one-shot order: "haul `qtyRequested` kg of `resource` to `destNormal`".
// Progress accumulates as loads arrive; the request is complete (and removed)
// once qtyDelivered ≥ qtyRequested. Because the game inventory is global, a
// delivery credits the request counter — the resource itself entered the pool
// when it was mined at the source.

export interface TransportRequestSave {
    id:           number;
    parentId?:    number;   // present on auto-created upstream input requests
    destName:     string;
    dnx: number; dny: number; dnz: number;
    resource:     string;
    qtyRequested: number;
    qtyDelivered: number;
}

let _nextRequestId = 1;

export class TransportRequest {
    readonly id:           number;
    // id of the request this one was auto-created to supply (a manufactured
    // resource's input). undefined for user-created top-level requests.
    readonly parentId:     number | undefined;
    readonly destNormal:   Vector3;
    readonly destName:     string;
    readonly resource:     Resource;
    readonly qtyRequested: number;

    qtyDelivered = 0;
    // kg reserved by transports currently en route. Not persisted — recomputed
    // as transports are re-dispatched on load.
    qtyInFlight  = 0;

    constructor(
        destNormal:   Vector3,
        destName:     string,
        resource:     Resource,
        qtyRequested: number,
        id?:          number,
        parentId?:    number,
    ) {
        this.id = id ?? _nextRequestId++;
        if (this.id >= _nextRequestId) _nextRequestId = this.id + 1;
        this.parentId     = parentId;
        this.destNormal   = destNormal.clone().normalize();
        this.destName     = destName;
        this.resource     = resource;
        this.qtyRequested = qtyRequested;
    }

    // kg still needing a transport assigned (excludes already-reserved loads).
    get remaining(): number {
        return Math.max(0, this.qtyRequested - this.qtyDelivered - this.qtyInFlight);
    }

    // kg not yet delivered (ignores in-flight) — drives the progress bar.
    get outstanding(): number {
        return Math.max(0, this.qtyRequested - this.qtyDelivered);
    }

    get complete(): boolean { return this.qtyDelivered >= this.qtyRequested; }

    toJSON(): TransportRequestSave {
        return {
            id:           this.id,
            parentId:     this.parentId,
            destName:     this.destName,
            dnx: this.destNormal.x, dny: this.destNormal.y, dnz: this.destNormal.z,
            resource:     this.resource.name,
            qtyRequested: this.qtyRequested,
            qtyDelivered: this.qtyDelivered,
        };
    }

    static fromJSON(save: TransportRequestSave, resources: Resource[]): TransportRequest | null {
        const res = resources.find(r => r.name === save.resource);
        if (!res) return null;
        const req = new TransportRequest(
            new Vector3(save.dnx, save.dny, save.dnz),
            save.destName,
            res,
            save.qtyRequested,
            save.id,
            save.parentId,
        );
        req.qtyDelivered = save.qtyDelivered ?? 0;
        return req;
    }
}

// ─── Queue ────────────────────────────────────────────────────────────────────

export class TransportQueue {
    readonly requests: TransportRequest[] = [];

    add(req: TransportRequest): void { this.requests.push(req); }

    remove(req: TransportRequest): void {
        const i = this.requests.indexOf(req);
        if (i !== -1) this.requests.splice(i, 1);
    }

    // Requests that still need a transport assigned.
    open(): TransportRequest[] {
        return this.requests.filter(r => r.remaining > 0);
    }

    // Direct children — requests auto-created to supply `req`.
    childrenOf(req: TransportRequest): TransportRequest[] {
        return this.requests.filter(r => r.parentId === req.id);
    }

    // `req` plus every request transitively created to supply it (its subtree).
    subtree(req: TransportRequest): TransportRequest[] {
        const out = [req];
        for (const child of this.childrenOf(req)) out.push(...this.subtree(child));
        return out;
    }

    // Drop completed requests; returns the removed ones (for logging/notify).
    prune(): TransportRequest[] {
        const done = this.requests.filter(r => r.complete);
        for (const r of done) this.remove(r);
        return done;
    }

    toJSON(): TransportRequestSave[] {
        // Persist only unfinished requests.
        return this.requests.filter(r => !r.complete).map(r => r.toJSON());
    }
}
