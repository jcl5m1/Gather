import {
    Scene, Vector3, Quaternion,
} from 'three';
import { R, RES_DIST, KSC_LAT, KSC_LON } from './constants';
import { Resource } from './resource';
import { Homebase } from './homebase';
import { ResourceNode } from './resourceNode';

// Surface normal pointing from Earth's center toward KSC (Y-up, X toward 0°lon/0°lat)
export const KSC_NORMAL = new Vector3(
     Math.cos(KSC_LAT) * Math.cos(KSC_LON),
     Math.sin(KSC_LAT),
    -Math.cos(KSC_LAT) * Math.sin(KSC_LON),
).normalize();

// Geographic north tangent at KSC — used as camera.up so screen-up = geographic north
export const KSC_NORTH_UP = new Vector3(
    -Math.sin(KSC_LAT) * Math.cos(KSC_LON),
     Math.cos(KSC_LAT),
     Math.sin(KSC_LAT) * Math.sin(KSC_LON),
).normalize();

const UP = new Vector3(0, 1, 0);  // pole direction for resource ring placement

export interface WorldResult {
    homebase:      Homebase;
    resourceNodes: ResourceNode[];
}

// Builds the world scene (homebase, resource pads) centered at KSC.
export function buildWorld(scene: Scene, resources: Resource[]): WorldResult {
    const homebase = new Homebase(scene, KSC_NORMAL);

    const poleToKsc = new Quaternion().setFromUnitVectors(UP, KSC_NORMAL);
    const angStep   = RES_DIST / R;

    const naturalResources = resources.filter(r => !r.isManufactured);
    const resourceNodes = naturalResources.map((res, i) => {
        const phi   = angStep;
        const theta = (i / naturalResources.length) * Math.PI * 2;
        const normal = new Vector3(
            Math.sin(phi) * Math.cos(theta),
            Math.cos(phi),
            Math.sin(phi) * Math.sin(theta),
        ).normalize().applyQuaternion(poleToKsc);
        return new ResourceNode(scene, res, normal);
    });

    return { homebase, resourceNodes };
}
