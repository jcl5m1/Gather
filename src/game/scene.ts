import { WebGLRenderer, PerspectiveCamera } from 'three';
import { log } from './logger';

export function createRenderer(): WebGLRenderer {
    // No logarithmicDepthBuffer — it uses EXT_frag_depth on WebGL1 which causes
    // GPU timeouts and WebGL context loss on iOS Safari, triggering page reloads.
    // Standard 24-bit depth buffer is sufficient: at near=1m, far=50Mm the worst-case
    // precision is ~0.2m at planet-zoom distances, fine for our 38km cloud/Earth gap.
    const renderer = new WebGLRenderer({ antialias: true });

    // Cap at 2x to avoid oversized framebuffers on iPhone 15 Pro (3x DPR = 1290x2796px)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    // near=1m avoids z-fighting near the camera; far=50Mm covers planet zoom
    return new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 5e7);
}
