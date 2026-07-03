import { WebGLRenderer, PerspectiveCamera } from 'three';
import { log } from './logger';

export function createRenderer(): WebGLRenderer {
    // No logarithmicDepthBuffer — it uses EXT_frag_depth on WebGL1 which causes
    // GPU timeouts and WebGL context loss on iOS Safari, triggering page reloads.
    // Standard 24-bit depth buffer is sufficient: at near=1m, far=4Gm the worst-case
    // precision is ~0.2m at planet-zoom distances, fine for our 38km cloud/Earth gap.
    const renderer = new WebGLRenderer({ antialias: true });

    // Render at 1x (drawing buffer = CSS pixels) and let the display hardware
    // upscale the canvas to physical device pixels. This minimizes fill-rate:
    // the fullscreen atmosphere/ocean shaders cover the fewest possible pixels
    // (1/4 of a 2x buffer, 1/9 of a 3x buffer), at the cost of some sharpness.
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Log WebGL context loss — on iOS this triggers a page reload, so seeing this
    // in the server log confirms the cause.
    renderer.domElement.addEventListener('webglcontextlost', e => {
        e.preventDefault(); // attempt to prevent automatic page reload
        log.error('WebGL context lost — GPU likely ran out of resources');
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
        log.info('WebGL context restored');
    });

    return renderer;
}

export function createCamera(): PerspectiveCamera {
    // near=1m avoids z-fighting near the camera; far=4Gm covers max zoom-out (3.5Gm altitude)
    return new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 4e9);
}
