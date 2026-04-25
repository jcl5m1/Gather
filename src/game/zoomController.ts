import { PerspectiveCamera, Vector3 } from 'three';
import { R } from './constants';
import { KSC_NORMAL } from './world';

interface ZoomLevel {
    height: number;  // metres above Earth surface
}

export interface ZoomSave {
    zoomIdx: number;
    posX:    number;
    posY:    number;
    posZ:    number;
}

export class ZoomController {
    // Exposed to the render loop for lerping
    readonly targetPos:   Vector3;
    readonly targetLook:  Vector3;
    readonly currentLook: Vector3;

    // Fixed field-of-view — zoom changes camera distance, not FOV
    readonly fov = 45;

    onLevelChange: (() => void) | null = null;

    private readonly homeNormal: Vector3;
    private levels: ZoomLevel[];
    private idx: number;

    constructor(startIdx = 9) {
        this.homeNormal = KSC_NORMAL.clone();

        // Heights in metres above surface; 45° FOV → visible span ≈ height × 0.83.
        this.levels = [
            { height:         300 },
            { height:         600 },
            { height:       3_000 },
            { height:      10_000 },
            { height:      30_000 },
            { height:     100_000 },
            { height:     350_000 },
            { height:   1_000_000 },
            { height:   5_000_000 },
            { height:  35_000_000 },
        ];

        this.idx = Math.max(0, Math.min(this.levels.length - 1, startIdx));

        const startH = this.levels[this.idx].height;
        this.targetPos   = this.homeNormal.clone().multiplyScalar(R + startH);
        this.targetLook  = new Vector3(0, 0, 0);
        this.currentLook = new Vector3(0, 0, 0);

        document.getElementById('btn-in')!.addEventListener('click',  () => this.set(this.idx - 1));
        document.getElementById('btn-out')!.addEventListener('click', () => this.set(this.idx + 1));
    }

    /** Current target height above Earth surface in metres */
    get targetHeight(): number { return Math.max(1, this.targetPos.length() - R); }

    initCamera(camera: PerspectiveCamera): void {
        camera.position.copy(this.targetPos);
        camera.fov = this.fov;
        camera.updateProjectionMatrix();
        camera.lookAt(this.currentLook);
    }

    zoomTo(idx: number): void {
        this.set(idx);
    }

    centerOnHome(): void {
        const h = this.levels[this.idx].height;
        this.targetPos.copy(this.homeNormal).multiplyScalar(R + h);
        this.targetLook.set(0, 0, 0);
        this.currentLook.set(0, 0, 0);
        this.onLevelChange?.();
    }

    toJSON(): ZoomSave {
        return {
            zoomIdx: this.idx,
            posX:    this.targetPos.x,
            posY:    this.targetPos.y,
            posZ:    this.targetPos.z,
        };
    }

    loadFrom(save: ZoomSave): void {
        this.idx = Math.max(0, Math.min(this.levels.length - 1, save.zoomIdx));
        const h = this.levels[this.idx].height;
        const savedPos = new Vector3(save.posX, save.posY, save.posZ);
        if (savedPos.length() > R / 2) {
            this.targetPos.copy(savedPos.normalize()).multiplyScalar(R + h);
        } else {
            this.targetPos.copy(this.homeNormal).multiplyScalar(R + h);
        }
    }

    // Continuous height update for pinch zoom — clamps to level range and snaps
    // idx to the nearest discrete level so +/- buttons work sensibly.
    setHeightDirect(height: number): void {
        const minH = this.levels[0].height;
        const maxH = this.levels[this.levels.length - 1].height;
        const h = Math.max(minH, Math.min(maxH, height));
        const dir = this.targetPos.clone().normalize();
        this.targetPos.copy(dir).multiplyScalar(R + h);
        const logH = Math.log(h);
        let best = 0, bestDist = Infinity;
        for (let i = 0; i < this.levels.length; i++) {
            const d = Math.abs(Math.log(this.levels[i].height) - logH);
            if (d < bestDist) { bestDist = d; best = i; }
        }
        this.idx = best;
    }

    private set(idx: number): void {
        this.idx = Math.max(0, Math.min(this.levels.length - 1, idx));
        const h = this.levels[this.idx].height;
        const dir = this.targetPos.clone().normalize();
        this.targetPos.copy(dir.lengthSq() > 0.5 ? dir : this.homeNormal).multiplyScalar(R + h);
        this.onLevelChange?.();
    }
}
