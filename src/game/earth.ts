import {
    Scene,
    AmbientLight,
    DirectionalLight,
    BufferGeometry,
    BufferAttribute,
    Points,
    PointsMaterial,
} from 'three';
import { R } from './constants';
import { EarthLOD } from './earthLOD';

export function addLighting(scene: Scene): void {
    scene.add(new AmbientLight(0xffffff, 0.4));
    const sun = new DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(R * 3, R * 4, R * 1.5);
    scene.add(sun);
}

export function addStars(scene: Scene): void {
    const geo = new BufferGeometry();
    const pts = new Float32Array(3000 * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = (Math.random() - 0.5) * R * 80;
    geo.setAttribute('position', new BufferAttribute(pts, 3));
    scene.add(new Points(geo, new PointsMaterial({ color: 0xffffff, size: R * 0.003 })));
}

// Grid texture is generated synchronously in the EarthLOD constructor,
// so onReady fires immediately — no network load.
export function addEarth(scene: Scene, onReady: () => void): EarthLOD {
    const lod = new EarthLOD(scene);
    onReady();
    return lod;
}
