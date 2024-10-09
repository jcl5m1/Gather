import * as THREE from 'three';
import { Body } from './Body';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import config from './config.json';
import { appendToLog } from './utils'; // Assuming you have a utility function for logging
let scene;
let camera;
let renderer;
let controls;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const cursorGeometry = new THREE.SphereGeometry(config.CURSOR_SIZE, 3, 3);
const cursorMaterial = new THREE.MeshBasicMaterial({ color: config.SELECTED_COLOR });
const cursor = new THREE.Mesh(cursorGeometry, cursorMaterial);
const currentHost = `http://${window.location.hostname}:8010`;
const logDiv = document.createElement('div');
let selectedBody = null;
let focusBody = null;
function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.domElement.style.border = 'none';
    logDiv.style.position = 'absolute';
    logDiv.style.top = '10px';
    logDiv.style.left = '10px';
    logDiv.style.color = 'white';
    logDiv.style.fontSize = '15px';
    logDiv.style.fontFamily = 'Arial';
    logDiv.innerText = `Console:`;
    document.body.appendChild(logDiv);
    appendToLog('Initializing scene...');
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);
    window.addEventListener('resize', onWindowResize);
    // Initialize OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.rotateSpeed = 0.5; // Default is 1.0
    controls.zoomSpeed = 1.0; // Default is 1.0
    controls.panSpeed = 0.8; // Default is 1.0
    controls.enableDamping = true; // Enable damping (inertia)
    controls.dampingFactor = 0.25; // Damping factor
    controls.screenSpacePanning = true; // Do not allow panning in screen space
    controls.minDistance = 10; // Minimum distance for zoom
    controls.maxDistance = 1000000; // Maximum distance for zoom
    controls.maxPolarAngle = Math.PI; // Limit vertical rotation
    controls.enableRotate = true;
    controls.enablePan = false;
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.RIGHT,
        MIDDLE: THREE.MOUSE.MIDDLE,
        RIGHT: THREE.MOUSE.LEFT
    };
    camera.position.z = 20000; // km
    controls.update();
    scene.add(cursor);
    const ambientLight = new THREE.AmbientLight(config.AMBIENT_LIGHT_INTENSITY); // Soft white light
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, config.DIR_LIGHT_INTENSITY);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(directionalLight);
    // Load the star texture and create a skybox
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(config.STARS_TEXTURE_URL, (texture) => {
        const skyboxGeometry = new THREE.SphereGeometry(1000000, 32, 32);
        const skyboxMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            color: 0x666666,
            side: THREE.BackSide
        });
        const skybox = new THREE.Mesh(skyboxGeometry, skyboxMaterial);
        scene.add(skybox);
    }, undefined, (error) => {
        appendToLog(`Error loading stars texture: ${error}`);
    });
    animate();
    document.addEventListener('contextmenu', event => event.preventDefault());
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    function onDocumentMouseDown(event) {
        if (event.button === 2) { // Right mouse button
            isDragging = true;
        }
    }
    function onDocumentMouseUp(event) {
        if (event.button === 2) { // Right mouse button
            isDragging = false;
        }
    }
    function onDocumentMouseMove(event) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(bodies.map(obj => obj.mesh));
        if (intersects.length > 0) {
            const intersection = intersects[0];
            cursor.position.copy(intersection.point);
        }
        previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
    }
    function toRadians(angle) {
        return angle * (Math.PI / 180);
    }
    document.addEventListener('mousedown', onDocumentMouseDown, false);
    document.addEventListener('mouseup', onDocumentMouseUp, false);
    document.addEventListener('mousemove', onDocumentMouseMove, false);
    fetch(`${currentHost}/api/object`)
        .then(response => response.json())
        .then(data => {
        let earth;
        data.forEach((item, index) => {
            let obj = Body.fromJSON(item);
            bodies.push(obj);
            scene.add(obj.mesh);
            console.log(`Added object: ${obj.name}`);
        });
        //for each object that is attached add mesh to parent mesh
        //for some reason this is does not work if you do it in the previous loop
        bodies.forEach((obj) => {
            if (obj.attached) {
                const parentObject = bodies.find(o => o.id == obj.parent);
                if (parentObject) {
                    parentObject.mesh.add(obj.mesh);
                }
            }
        });
        appendToLog('Loaded Objects:' + bodies.length);
    })
        .catch(error => {
        console.error('Error fetching object names:', error);
    });
}
function highlightSelectedBody(body) {
    if (body === selectedBody) {
        return;
    }
    if ((body === null || body === void 0 ? void 0 : body.name) === "Earth") {
        body = null;
    }
    if (selectedBody) {
        // Reset the color of the previously selected object
        selectedBody.mesh.material.color.set(selectedBody.color);
    }
    if (body) {
        // Highlight the new selected object
        appendToLog(`Selected: ${body.name} ${body.id} `);
        body.mesh.material.color.set(config.SELECTED_COLOR);
    }
    selectedBody = body;
}
function onDocumentMouseClick(event) {
    var _a;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(bodies.map(obj => obj.mesh));
    if (intersects.length > 0) {
        const intersection = intersects[0];
        let newlySelectedObject = (_a = bodies.find(obj => obj.mesh === intersection.object)) !== null && _a !== void 0 ? _a : null;
        if (newlySelectedObject) {
            highlightSelectedBody(newlySelectedObject);
        }
    }
    else {
        highlightSelectedBody(null);
    }
}
function onAddItemOnEarth(event) {
    //find object named earth
    const earth = bodies.find(o => o.name == "Earth");
    if (!earth) {
        console.error('Earth object not found');
        return;
    }
    const newObject = new Body("", 'Item', '#00ff00', 100, 1, 'sphere', earth.id, true, cursor.position.clone(), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
    bodies.push(newObject);
    scene.add(newObject.mesh);
    console.log('New sphere object created at cursor position.');
    fetch(`${currentHost}/api/addObject`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(newObject.toJSON())
    })
        .then(response => response.json())
        .then(data => {
        console.log('Object successfully added to the server:', data);
    })
        .catch(error => {
        console.error('Error adding object to the server:', error);
    });
}
document.addEventListener('click', onDocumentMouseClick, false);
function onDocumentMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(bodies.map(obj => obj.mesh));
    if (intersects.length > 0) {
        const intersection = intersects[0];
        cursor.position.copy(intersection.point);
    }
}
document.addEventListener('mousemove', onDocumentMouseMove, false);
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
// function onDocumentMouseWheel(event: WheelEvent) {
//     if (event.deltaY < 0) {
//         if(camera.position.length() < 1) // too close to the origin
//             return
//     }
//     camera.position.z += event.deltaY * 0.0005 * camera.position.length();
// }
function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
    }
    else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}
//document.addEventListener('dblclick', toggleFullScreen);
//document.addEventListener('wheel', onDocumentMouseWheel, false);
function animate() {
    requestAnimationFrame(animate);
    // Adjust the rotateSpeed based on the distance
    if (focusBody) {
        //approximate stationary drag point on a planet. close for earth, but not exact
        controls.minDistance = focusBody.radius * 1.1; // Set minimum distance based on focusBody radius
        const distance = camera.position.length();
        controls.rotateSpeed = Math.max(0.01, Math.min(1, (distance - focusBody.radius) / 20000)); // Example adjustment
    }
    controls.update();
    //for each object in Objects, update the position
    bodies.forEach((obj) => {
        obj.update();
    });
    renderer.render(scene, camera);
}
init();
