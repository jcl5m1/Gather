import * as THREE from 'three';

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;

class Object {
    name: string;
    radius: GLfloat;
    mass: GLfloat;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    angularVelocity: THREE.Vector3;
    mesh: THREE.Mesh;

    static fromJSON(json: any): Object {
        return new Object(
            json.name,
            json.color,
            json.radius,
            json.mass,
            json.shape,
            new THREE.Vector3(parseFloat(json.position.x), parseFloat(json.position.y), parseFloat(json.position.z)),
            new THREE.Vector3(parseFloat(json.velocity.x), parseFloat(json.velocity.y), parseFloat(json.velocity.z)),
            new THREE.Vector3(parseFloat(json.angularVelocity.x), parseFloat(json.angularVelocity.y), parseFloat(json.angularVelocity.z)),
        );
    }

    constructor(name: string, 
        color: string, 
        radius: GLfloat, 
        mass: GLfloat, 
        shape: string,
        position: THREE.Vector3, 
        velocity: THREE.Vector3, 
        angularVelocity: THREE.Vector3) {
        this.name = name;
        this.radius = radius;
        this.mass = mass;
        this.position = position;
        this.velocity = velocity;
        this.angularVelocity = angularVelocity;

        // if (shape == 'sphere') {
        //     const geometry = new THREE.IcosahedronGeometry(5);
        // else
        const geometry = new THREE.IcosahedronGeometry(this.radius, 5); 

        //convert color string to THREE.Color
        const colorValue = parseInt(color.replace(/^#/, ''), 16);

        const material = new THREE.MeshBasicMaterial({ color: colorValue, wireframe: true });
        this.mesh = new THREE.Mesh(geometry, material);

    }

    update() {
        this.position.add(this.velocity);
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);

        const axis = this.angularVelocity.clone().normalize();
        const angle = this.angularVelocity.length()*10.0;

        const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        this.mesh.quaternion.multiplyQuaternions(quaternion, this.mesh.quaternion);

    }
}   

let objects: Object[] = [];

function init() {    
    console.log('Initializing scene...');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.domElement.style.border = 'none';

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize);

    camera.position.z = 20000; // km

    animate();

    const currentHost = `http://${window.location.hostname}:8010`;
    fetch(`${currentHost}/api/object`)
        .then(response => response.json())
        .then(data => {
            data.forEach((item: any, index: number) => {
                let obj = Object.fromJSON(item);
                objects.push(obj);
                const nameDiv = document.createElement('div');
                nameDiv.style.position = 'absolute';
                nameDiv.style.top = `${10 + index * 30}px`;
                nameDiv.style.left = '10px';
                nameDiv.style.color = 'white';
                nameDiv.style.fontSize = '20px';
                nameDiv.style.fontFamily = 'Arial';
                nameDiv.innerText = `Object: ${item.name}`;
                document.body.appendChild(nameDiv);
                scene.add(obj.mesh);
                console.log(`Added object: ${obj.name}`);
            });
        })
        .catch(error => {
            console.error('Error fetching object names:', error);
        });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onDocumentMouseWheel(event: WheelEvent) {
    if (event.deltaY < 0) {
        if(camera.position.length() < 1) // too close to the origin
            return
    }
    camera.position.z += event.deltaY * 0.0005 * camera.position.length();
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

document.addEventListener('dblclick', toggleFullScreen);

document.addEventListener('wheel', onDocumentMouseWheel, false);

function animate() {
    requestAnimationFrame(animate);
    //for each object in Objects, update the position
    objects.forEach((obj) => {
        obj.update();    
    });
    renderer.render(scene, camera);
}
init();
