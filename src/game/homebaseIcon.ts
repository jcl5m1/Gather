import { PerspectiveCamera, Vector3, MathUtils } from 'three';
import { R, HOUSE_R } from './constants';

const ICON_SIZE_PX    = 14;
const HIT_SIZE_PX     = ICON_SIZE_PX * 2;
const VISIBLE_THRESHOLD_PX = 10; // show icon when projected diameter < this

export class HomebaseIcon {
    private el: HTMLElement;

    constructor(
        private homebasePos: Vector3,
        private onTap: () => void,
    ) {
        // Outer element is the tap target (2× visual size)
        this.el = document.createElement('div');
        Object.assign(this.el.style, {
            position:       'fixed',
            width:          `${HIT_SIZE_PX}px`,
            height:         `${HIT_SIZE_PX}px`,
            display:        'none',
            cursor:         'pointer',
            transform:      'translate(-50%, -50%)',
            zIndex:         '5',
            pointerEvents:  'auto',
            alignItems:     'center',
            justifyContent: 'center',
        });

        // Inner element is the visible dot
        const visual = document.createElement('div');
        Object.assign(visual.style, {
            width:         `${ICON_SIZE_PX}px`,
            height:        `${ICON_SIZE_PX}px`,
            borderRadius:  '50%',
            background:    '#ffd54f',
            border:        '2px solid rgba(255,255,255,0.7)',
            boxShadow:     '0 0 10px rgba(255,213,79,0.7)',
            pointerEvents: 'none',
            flexShrink:    '0',
        });
        this.el.appendChild(visual);
        document.body.appendChild(this.el);

        this.el.addEventListener('click', onTap);
        this.el.addEventListener('touchstart', e => {
            e.preventDefault();
            onTap();
        }, { passive: false });
    }

    // Call once per frame. Shows/hides icon and moves it to the projected screen position.
    update(camera: PerspectiveCamera): void {
        const distance    = camera.position.distanceTo(this.homebasePos);
        const halfFovRad  = MathUtils.degToRad(camera.fov / 2);
        const pxPerMeter  = (window.innerHeight / 2) / (distance * Math.tan(halfFovRad));
        const diameter    = HOUSE_R * 2 * pxPerMeter;

        if (diameter >= VISIBLE_THRESHOLD_PX) {
            this.el.style.display = 'none';
            return;
        }

        // Project world position → NDC → screen pixels
        const ndc = this.homebasePos.clone().project(camera);
        if (ndc.z > 1) { // behind camera
            this.el.style.display = 'none';
            return;
        }

        const screenX = (ndc.x  + 1) / 2 * window.innerWidth;
        const screenY = (-ndc.y + 1) / 2 * window.innerHeight;

        // Occluded when homebase is on the far hemisphere: C·P < R²
        const occluded = camera.position.dot(this.homebasePos) < R * R;

        this.el.style.display = 'flex';
        this.el.style.opacity = occluded ? '0.25' : '1';
        this.el.style.left    = `${screenX}px`;
        this.el.style.top     = `${screenY}px`;
    }
}
