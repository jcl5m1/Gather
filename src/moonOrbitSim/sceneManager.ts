import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { MoonState, PlanetState } from './types';

export class SceneManager {
    private scene: THREE.Scene = new THREE.Scene();
    private camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    private renderer: THREE.WebGLRenderer = new THREE.WebGLRenderer();
    private controls!: OrbitControls;
    
    // Scene objects
    private planet!: THREE.Mesh;
    private moonIterative!: THREE.Mesh;
    private moonAnalytical!: THREE.Mesh;
    private periapsisMarker!: THREE.Mesh;
    private apoapsisMarker!: THREE.Mesh;
    private iterativeOrbitLine!: THREE.Line;
    private analyticalOrbitLine!: THREE.Line;
    private bezierOrbitLine!: THREE.Line;
    private controlPoints: THREE.Mesh[] = [];
    private controlLines: THREE.Line[] = [];

    // Geometries and materials
    private iterativeOrbitGeometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    private analyticalOrbitGeometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    private bezierOrbitGeometry: THREE.BufferGeometry = new THREE.BufferGeometry();

    constructor() {
        this.initScene();
        this.initLights();
        this.initObjects();
        this.setupEventListeners();
    }

    private initScene(): void {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        this.camera.position.set(30, 20, 30);
        this.camera.lookAt(this.scene.position);

        // Add axes helper
        const axesHelper = new THREE.AxesHelper(20); // Size of 20 units
        this.scene.add(axesHelper);
    }

    private initLights(): void {
        const ambientLight = new THREE.AmbientLight(0x404040);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 3, 5);
        this.scene.add(directionalLight);
    }

    private initObjects(): void {
        // Planet
        const planetGeometry = new THREE.SphereGeometry(3, 32, 32);
        const planetMaterial = new THREE.MeshPhongMaterial({ color: 0x3366cc });
        this.planet = new THREE.Mesh(planetGeometry, planetMaterial);
        this.scene.add(this.planet);

        // Moons
        const moonGeometry = new THREE.SphereGeometry(1.0, 32, 32);
        const moon1Material = new THREE.MeshPhongMaterial({ color: 0xcccccc });
        const moon2Material = new THREE.MeshPhongMaterial({ color: 0xff6666 });
        this.moonIterative = new THREE.Mesh(moonGeometry, moon1Material);
        this.moonAnalytical = new THREE.Mesh(moonGeometry, moon2Material);
        this.scene.add(this.moonIterative);
        this.scene.add(this.moonAnalytical);

        // Markers
        const markerGeometry = new THREE.SphereGeometry(0.5, 16, 16);
        this.periapsisMarker = new THREE.Mesh(
            markerGeometry,
            new THREE.MeshBasicMaterial({ color: 0x00ff00 })
        );
        this.periapsisMarker.visible = true;
        
        this.apoapsisMarker = new THREE.Mesh(
            markerGeometry,
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        this.apoapsisMarker.visible = true;
        this.scene.add(this.periapsisMarker);
        this.scene.add(this.apoapsisMarker);

        // Orbit lines
        this.iterativeOrbitGeometry = new THREE.BufferGeometry();
        this.analyticalOrbitGeometry = new THREE.BufferGeometry();
        this.bezierOrbitGeometry = new THREE.BufferGeometry();

        this.iterativeOrbitLine = new THREE.Line(
            this.iterativeOrbitGeometry,
            new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.5 })
        );
        this.analyticalOrbitLine = new THREE.Line(
            this.analyticalOrbitGeometry,
            new THREE.LineBasicMaterial({ color: 0xff0000, opacity: 0.5 })
        );
        this.bezierOrbitLine = new THREE.Line(
            this.bezierOrbitGeometry,
            new THREE.LineBasicMaterial({ color: 0x00ff00, opacity: 0.8, transparent: true })
        );

        this.scene.add(this.iterativeOrbitLine);
        this.scene.add(this.analyticalOrbitLine);
        this.scene.add(this.bezierOrbitLine);

        // Control points
        const controlPointGeometry = new THREE.SphereGeometry(1.5, 8, 8);
        const controlPointMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff });
        for (let i = 0; i < 12; i++) {
            const point = new THREE.Mesh(controlPointGeometry, controlPointMaterial);
            point.visible = false;
            this.scene.add(point);
            this.controlPoints.push(point);
        }

        // Control lines
        const controlLineMaterial = new THREE.LineBasicMaterial({ 
            color: 0xff00ff,
            opacity: 1.0,
            transparent: true
        });
        for (let i = 0; i < 8; i++) {
            const lineGeometry = new THREE.BufferGeometry();
            const line = new THREE.Line(lineGeometry, controlLineMaterial);
            line.visible = false;
            this.scene.add(line);
            this.controlLines.push(line);
        }
    }

    private setupEventListeners(): void {
        window.addEventListener('resize', this.onWindowResize.bind(this), false);
    }

    private onWindowResize(): void {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    updateMoonPositions(moon1State: MoonState, moon2State: MoonState): void {
        this.moonIterative.position.copy(moon1State.position);
        this.moonAnalytical.position.copy(moon2State.position);
    }

    updateIterativeOrbitTrails(points: THREE.Vector3[]): void {
        this.iterativeOrbitGeometry.setFromPoints(points);
    }

    updateAnalyticalOrbit(points: THREE.Vector3[]): void {
        this.analyticalOrbitGeometry.setFromPoints(points);
        this.analyticalOrbitLine.visible = true;
    }

    updateBezierOrbit(points: THREE.Vector3[]): void {
        this.bezierOrbitGeometry.setFromPoints(points);
        this.bezierOrbitLine.visible = true;
    }

    updateMarkers(periapsisPos: THREE.Vector3, apoapsisPos: THREE.Vector3, visible: boolean): void {
        this.periapsisMarker.position.copy(periapsisPos);
        this.apoapsisMarker.position.copy(apoapsisPos);
        this.periapsisMarker.visible = visible;
        this.apoapsisMarker.visible = visible;
    }

    updateControlPoints(points: THREE.Vector3[], visible: boolean): void {
        points.forEach((point, i) => {
            this.controlPoints[i].position.copy(point);
            this.controlPoints[i].visible = visible;
        });
    }

    updateControlLines(linePoints: [THREE.Vector3, THREE.Vector3][], visible: boolean): void {
        linePoints.forEach((points, i) => {
            this.controlLines[i].geometry.setFromPoints(points);
            this.controlLines[i].visible = visible;
        });
    }

    showOrbitVisualizations(show: boolean = true): void {
        this.bezierOrbitLine.visible = show;
        this.periapsisMarker.visible = show;
        this.apoapsisMarker.visible = show;
        this.controlPoints.forEach(point => point.visible = show);
        this.controlLines.forEach(line => line.visible = show);
    }

    render(): void {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}
