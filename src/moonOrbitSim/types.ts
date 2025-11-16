import * as THREE from 'three';

export interface BezierCurveRender {
    curve: BezierCurve;
    startPoint: THREE.Mesh;
    endPoint: THREE.Mesh;
    controlPoints: THREE.Mesh[];
    controlLines: THREE.Line[];
    setVisibility(show: boolean, showControls: boolean): void;
    updatePoints(): void;
    cleanup(): void;
}

export class BezierCurveRenderer implements BezierCurveRender {
    curve: BezierCurve;
    startPoint: THREE.Mesh;
    endPoint: THREE.Mesh;
    controlPoints: THREE.Mesh[] = [];
    controlLines: THREE.Line[] = [];
    private scene: THREE.Scene;
    private color: number;

    constructor(scene: THREE.Scene, curve: BezierCurve, color: number = 0x00ff00) {
        this.scene = scene;
        this.curve = curve;
        this.color = color;

        // Initialize end points
        const endPointGeometry = new THREE.SphereGeometry(0.3, 16, 16);
        const endPointMaterial = new THREE.MeshBasicMaterial({ 
            color: this.color,
            transparent: true,
            opacity: 0.8
        });
        
        this.startPoint = new THREE.Mesh(endPointGeometry, endPointMaterial);
        this.endPoint = new THREE.Mesh(endPointGeometry, endPointMaterial);
        scene.add(this.startPoint);
        scene.add(this.endPoint);

        // Initialize control points
        const controlPointGeometry = new THREE.SphereGeometry(0.2, 16, 16);
        const controlPointMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00,
            transparent: true,
            opacity: 0.4
        });
        
        for (let i = 0; i < 2; i++) {
            const point = new THREE.Mesh(controlPointGeometry, controlPointMaterial);
            point.visible = false;
            scene.add(point);
            this.controlPoints.push(point);
        }

        // Initialize control lines
        const controlLineMaterial = new THREE.LineBasicMaterial({ 
            color: 0xffff00,
            opacity: 0.3,
            transparent: true
        });
        
        for (let i = 0; i < 2; i++) {
            const lineGeometry = new THREE.BufferGeometry();
            const line = new THREE.Line(lineGeometry, controlLineMaterial);
            line.visible = false;
            scene.add(line);
            this.controlLines.push(line);
        }

        this.updatePoints();
    }

    updatePoints(): void {
        const points = this.curve.getControlPoints();
        
        // Update end points
        this.startPoint.position.copy(points.p0);
        this.endPoint.position.copy(points.p3);

        // Update control points
        this.controlPoints[0].position.copy(points.p1);
        this.controlPoints[1].position.copy(points.p2);

        // Update control lines
        this.controlLines[0].geometry.setFromPoints([points.p0, points.p1]);
        this.controlLines[1].geometry.setFromPoints([points.p2, points.p3]);
    }

    setVisibility(show: boolean, showControls: boolean = false): void {
        this.startPoint.visible = show;
        this.endPoint.visible = show;
        this.controlPoints.forEach(point => point.visible = show && showControls);
        this.controlLines.forEach(line => line.visible = show && showControls);
    }

    cleanup(): void {
        console.log('[DEBUG] BezierCurveRenderer.cleanup() called', {
            controlPointsCount: this.controlPoints.length,
            controlLinesCount: this.controlLines.length,
            startPointInScene: this.startPoint.parent === this.scene,
            endPointInScene: this.endPoint.parent === this.scene
        });

        // Hide objects first
        this.startPoint.visible = false;
        this.endPoint.visible = false;
        this.controlPoints.forEach(point => point.visible = false);
        this.controlLines.forEach(line => line.visible = false);
        
        // Remove from scene
        if (this.startPoint.parent === this.scene) {
            console.log('[DEBUG] Removing startPoint from scene');
            this.scene.remove(this.startPoint);
        }
        if (this.endPoint.parent === this.scene) {
            console.log('[DEBUG] Removing endPoint from scene');
            this.scene.remove(this.endPoint);
        }
        this.controlPoints.forEach((point, index) => {
            if (point.parent === this.scene) {
                console.log(`[DEBUG] Removing controlPoint ${index} from scene`);
                this.scene.remove(point);
            }
        });
        this.controlLines.forEach((line, index) => {
            if (line.parent === this.scene) {
                console.log(`[DEBUG] Removing controlLine ${index} from scene`);
                this.scene.remove(line);
            }
        });
        
        // Dispose of geometries and materials
        this.startPoint.geometry.dispose();
        this.endPoint.geometry.dispose();
        if (this.startPoint.material instanceof THREE.Material) {
            this.startPoint.material.dispose();
        }
        if (this.endPoint.material instanceof THREE.Material) {
            this.endPoint.material.dispose();
        }
        this.controlPoints.forEach(point => {
            point.geometry.dispose();
            if (point.material instanceof THREE.Material) {
                point.material.dispose();
            }
        });
        this.controlLines.forEach(line => {
            line.geometry.dispose();
            if (line.material instanceof THREE.Material) {
                line.material.dispose();
            }
        });
        
        console.log('[DEBUG] BezierCurveRenderer.cleanup() completed');
    }
}

export interface OrbitGeometryRender {
    // Core Three.js objects for rendering
    orbitLine: THREE.Line;
    bezierRenderers: BezierCurveRenderer[];
    periapsisMarker: THREE.Mesh;
    apoapsisMarker: THREE.Mesh;

    // Methods for updating the visual representation
    updateOrbitLine(points: THREE.Vector3[]): void;
    updateBezierCurves(curves: BezierCurve[]): void;
    updateMarkers(periapsisPos: THREE.Vector3, apoapsisPos: THREE.Vector3, visible: boolean, showApoapsis?: boolean): void;
    setVisibility(show: boolean): void;
    cleanup(): void;
}

export class OrbitGeometryRenderer implements OrbitGeometryRender {
    orbitLine: THREE.Line;
    bezierRenderers: BezierCurveRenderer[] = [];
    periapsisMarker: THREE.Mesh;
    apoapsisMarker: THREE.Mesh;

    private scene: THREE.Scene;
    private color: number;

    constructor(scene: THREE.Scene, orbitColor: number = 0x00ff00) {
        this.scene = scene;
        this.color = orbitColor;

        console.log('[DEBUG] OrbitGeometryRenderer constructor called', {
            sceneChildrenBefore: scene.children.length,
            orbitColor: '0x' + orbitColor.toString(16)
        });

        // Initialize orbit line
        const orbitGeometry = new THREE.BufferGeometry();
        this.orbitLine = new THREE.Line(
            orbitGeometry,
            new THREE.LineBasicMaterial({ 
                color: orbitColor, 
                opacity: 0.8, 
                transparent: true 
            })
        );
        scene.add(this.orbitLine);
        console.log('[DEBUG] Added orbitLine to scene, scene children:', scene.children.length);

        // Initialize markers
        const markerGeometry = new THREE.SphereGeometry(0.5, 16, 16);
        this.periapsisMarker = new THREE.Mesh(
            markerGeometry,
            new THREE.MeshBasicMaterial({ color: 0x00ff00 })
        );
        this.apoapsisMarker = new THREE.Mesh(
            markerGeometry,
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        scene.add(this.periapsisMarker);
        scene.add(this.apoapsisMarker);
        console.log('[DEBUG] Added markers to scene, scene children:', scene.children.length);
    }

    updateOrbitLine(points: THREE.Vector3[]): void {
        this.orbitLine.geometry.setFromPoints(points);
    }

    updateBezierCurves(curves: BezierCurve[]): void {
        // Clean up old bezier renderers
        this.bezierRenderers.forEach(renderer => renderer.cleanup());
        this.bezierRenderers = [];

        // Create new bezier renderers
        curves.forEach(curve => {
            const renderer = new BezierCurveRenderer(this.scene, curve, this.color);
            this.bezierRenderers.push(renderer);
        });
    }

    updateMarkers(periapsisPos: THREE.Vector3, apoapsisPos: THREE.Vector3, visible: boolean, showApoapsis: boolean = true): void {
        this.periapsisMarker.position.copy(periapsisPos);
        this.apoapsisMarker.position.copy(apoapsisPos);
        this.periapsisMarker.visible = visible;
        this.apoapsisMarker.visible = visible && showApoapsis;
    }

    setVisibility(show: boolean): void {
        this.orbitLine.visible = show;
        this.bezierRenderers.forEach(renderer => renderer.setVisibility(show, false));
        this.periapsisMarker.visible = show;
        this.apoapsisMarker.visible = show;
    }

    cleanup(): void {
        console.log('[DEBUG] OrbitGeometryRenderer.cleanup() called', {
            bezierRenderersCount: this.bezierRenderers.length,
            orbitLineInScene: this.orbitLine.parent === this.scene,
            periapsisMarkerInScene: this.periapsisMarker.parent === this.scene,
            apoapsisMarkerInScene: this.apoapsisMarker.parent === this.scene,
            sceneChildrenBefore: this.scene.children.length
        });

        // Hide all objects first
        this.orbitLine.visible = false;
        this.periapsisMarker.visible = false;
        this.apoapsisMarker.visible = false;
        
        // Clean up bezier renderers
        this.bezierRenderers.forEach((renderer, index) => {
            console.log(`[DEBUG] Cleaning up bezier renderer ${index}`);
            renderer.cleanup();
        });
        
        // Remove all objects from scene (check if they're actually in the scene first)
        if (this.orbitLine.parent === this.scene) {
            console.log('[DEBUG] Removing orbitLine from scene');
            this.scene.remove(this.orbitLine);
        } else {
            console.log('[DEBUG] orbitLine not in scene, parent:', this.orbitLine.parent);
        }
        if (this.periapsisMarker.parent === this.scene) {
            console.log('[DEBUG] Removing periapsisMarker from scene');
            this.scene.remove(this.periapsisMarker);
        } else {
            console.log('[DEBUG] periapsisMarker not in scene, parent:', this.periapsisMarker.parent);
        }
        if (this.apoapsisMarker.parent === this.scene) {
            console.log('[DEBUG] Removing apoapsisMarker from scene');
            this.scene.remove(this.apoapsisMarker);
        } else {
            console.log('[DEBUG] apoapsisMarker not in scene, parent:', this.apoapsisMarker.parent);
        }

        // Dispose of geometry and material to free resources
        this.orbitLine.geometry.dispose();
        if (this.orbitLine.material instanceof THREE.Material) {
            this.orbitLine.material.dispose();
        }
        this.periapsisMarker.geometry.dispose();
        if (this.periapsisMarker.material instanceof THREE.Material) {
            this.periapsisMarker.material.dispose();
        }
        this.apoapsisMarker.geometry.dispose();
        if (this.apoapsisMarker.material instanceof THREE.Material) {
            this.apoapsisMarker.material.dispose();
        }

        // Clear arrays
        this.bezierRenderers = [];
        
        console.log('[DEBUG] OrbitGeometryRenderer.cleanup() completed', {
            sceneChildrenAfter: this.scene.children.length,
            bezierRenderersCleared: true
        });
    }
}


export interface BezierCurvePoints {
    p0: THREE.Vector3;
    p1: THREE.Vector3;
    p2: THREE.Vector3;
    p3: THREE.Vector3;
}

export class BezierCurve {
    private points: BezierCurvePoints;

    constructor(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) {
        this.points = { p0, p1, p2, p3 };
    }

    getPoint(t: number): THREE.Vector3 {
        const point = new THREE.Vector3();
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;

        point.x = mt3 * this.points.p0.x + 3 * mt2 * t * this.points.p1.x + 3 * mt * t2 * this.points.p2.x + t3 * this.points.p3.x;
        point.y = mt3 * this.points.p0.y + 3 * mt2 * t * this.points.p1.y + 3 * mt * t2 * this.points.p2.y + t3 * this.points.p3.y;
        point.z = mt3 * this.points.p0.z + 3 * mt2 * t * this.points.p1.z + 3 * mt * t2 * this.points.p2.z + t3 * this.points.p3.z;

        return point;
    }

    getControlPoints(): BezierCurvePoints {
        return this.points;
    }

    // Generate points along the curve for visualization
    getPoints(numPoints: number = 25): THREE.Vector3[] {
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            points.push(this.getPoint(t));
        }
        return points;
    }

    // Static helper to generate points from multiple curves
    static getPointsFromCurves(curves: BezierCurve[], numPointsPerCurve: number = 25): THREE.Vector3[] {
        const points: THREE.Vector3[] = [];
        curves.forEach(curve => {
            points.push(...curve.getPoints(numPointsPerCurve));
        });
        return points;
    }
}

export interface OrbitGeometry {
    render: OrbitGeometryRender;
    type: 'elliptical' | 'hyperbolic' | 'parabolic';
    analyticalPoints: THREE.Vector3[];
    bezierPoints: THREE.Vector3[];  // Points generated from bezier curves
    bezierCurves: BezierCurve[];  // Store the 4 Bezier curves
    periapsisPoint?: THREE.Vector3;
    apoapsisPoint?: THREE.Vector3;
    parameters: {
        a: number;        // semi-major axis
        e: number;        // eccentricity
        period: number;   // orbital period
        h: THREE.Vector3; // angular momentum vector
        eVec: THREE.Vector3; // eccentricity vector
    };
}

export interface OrbitControls extends THREE.EventDispatcher {
    enabled: boolean;
    enableDamping: boolean;
    dampingFactor: number;
    update(): void;
}
