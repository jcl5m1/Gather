/**
 * @deprecated This file is legacy code and not used by the current webpack build system.
 * The active application uses src/moonOrbitSim/index.ts or src/mineGather/index.ts.
 * This file is kept for reference but should not be modified.
 */

import * as THREE from 'three';
import { RenderBody } from './renderbody';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import config from './config.json';
import { appendToLog } from './utils'; // Assuming you have a utility function for logging
import * as utils from './utils';
import * as state from './state';

// Legacy Body class for deprecated code
class Body {
    position: THREE.Vector3 = new THREE.Vector3();
    velocity: THREE.Vector3 = new THREE.Vector3();
    id: string = '';
    name: string = '';
    data: any = {};
    
    constructor(init: Partial<Body>) {
        Object.assign(this, init);
    }
    
    toJSON(): any {
        return {
            position: { x: this.position.x, y: this.position.y, z: this.position.z },
            velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
            id: this.id,
            name: this.name,
            data: this.data
        };
    }
}

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera; // Legacy - kept for reference
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const cursorGeometry = new THREE.SphereGeometry(config.CURSOR_SIZE, 3, 3);
const cursorMaterial = new THREE.MeshBasicMaterial({ color: config.SELECTED_COLOR });
const cursor = new THREE.Mesh(cursorGeometry, cursorMaterial);

let selectedBody: RenderBody | null = null;
let focusBody: RenderBody | null = null;

function init() {    
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.domElement.style.border = 'none';
    state.init();
    utils.init(document);
    utils.setModeUI(state.Mode[state.mode]);
    appendToLog('Initializing scene...');

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize);

    // Initialize OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.rotateSpeed = 0.5; // Default is 1.0
    controls.zoomSpeed = 1.0;   // Default is 1.0
    controls.panSpeed = 0.8;    // Default is 1.0
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

    camera.position.z = 10000; // km
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

    function onDocumentMouseDown(event: MouseEvent) {
        if (event.button === 2) { // Right mouse button
            isDragging = true;
        }
    }

    function onDocumentMouseUp(event: MouseEvent) {
        if (event.button === 2) { // Right mouse button
            isDragging = false;
        }
    }

    async function updateHoverText(intersectedBody: RenderBody, event: MouseEvent) {
        if (intersectedBody && intersectedBody.name === "Resource") {
            const resource = await utils.getResourceById(intersectedBody.data.referenceId);
            if (resource) {
                utils.hoverTextDiv.style.position = 'absolute';
                utils.hoverTextDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
                utils.hoverTextDiv.style.color = 'white';
                utils.hoverTextDiv.style.padding = '5px';
                utils.hoverTextDiv.style.borderRadius = '5px';
                utils.hoverTextDiv.innerText = resource.name;
                utils.hoverTextDiv.style.left = `${event.clientX+10}px`;
                utils.hoverTextDiv.style.top = `${event.clientY+5}px`;
                utils.hoverTextDiv.style.display = 'block';
            }
        }
    }

    function onDocumentMouseMove(event: MouseEvent) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(state.bodies.map(obj => obj.mesh));
    
        if (intersects.length > 0) {
            const intersection = intersects[0];
            cursor.position.copy(intersection.point);

            const intersectedBody = state.bodies.find(obj => obj.mesh === intersection.object) ?? null;
            if (intersectedBody && intersectedBody.name === "Resource") {
                updateHoverText(intersectedBody, event);
            } else {
                utils.hoverTextDiv.style.display = 'none';
//                utils.hoverTextDiv.style.display = 'none';
            }


        }
    
        previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
    }

    function toRadians(angle: number) {
        return angle * (Math.PI / 180);
    }

    document.addEventListener('mousedown', onDocumentMouseDown, false);
    document.addEventListener('mouseup', onDocumentMouseUp, false);
    document.addEventListener('mousemove', onDocumentMouseMove, false);
    
    fetch(`${utils.currentHost}/api?table=body`)
        .then(response => response.json())
        .then(data => {
            data.forEach((item: any, index: number) => {
                let obj = RenderBody.fromJSON(item);
                state.bodies.push(obj);
                scene.add(obj.mesh);
                console.log(`Added body: ${obj.name}`);
            });

            //for each object that is attached add mesh to parent mesh
            //for some reason this is does not work if you do it in the previous loop
            state.bodies.forEach((obj) => {
                if (obj.attached) {
                    const parentBody = state.bodies.find(o => o.id == obj.parentId);
                    if (parentBody) {
                        parentBody.mesh.add(obj.mesh);
                    }
                }
            });


            appendToLog('Loaded Bodies:' + state.bodies.length);
        })
        .catch(error => {
            console.error('Error fetching body names:', error);
        });
}


function highlightSelectedBody(body: RenderBody | null) {
    if (body === selectedBody) {
        return;
    }

    if (selectedBody) {
        // Reset the color of the previously selected object
        (selectedBody.mesh.material as THREE.MeshBasicMaterial).color.set(selectedBody.color);
    }
    if (body) {
        // Highlight the new selected object
        appendToLog(`Selected: ${body.name} ${body.id} `);
        if(body.name != "Earth") {
            (body.mesh.material as THREE.MeshBasicMaterial).color.set(config.SELECTED_COLOR);
        }
    }
    selectedBody = body;
}

function onDocumentMouseClick(event: MouseEvent) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(state.bodies.map(obj => obj.mesh));

    if (intersects.length > 0) {
        const intersection = intersects[0];
        let newlySelectedObject = state.bodies.find(obj => obj.mesh === intersection.object) ?? null;
        if (newlySelectedObject) {
            if (newlySelectedObject === selectedBody) {
                let obj_data = utils.getById('body',newlySelectedObject.id);
                obj_data.then(data => {
                    handleAction(data[0], intersection);
                }).catch(error => { console.error('Error fetching resource:', error); });
                return
            }
            highlightSelectedBody(newlySelectedObject);
        }
    }
    else {
        highlightSelectedBody(null);
    }
    
}

function handleAction(body: any, intersection: THREE.Intersection) {
    //inefficient to call every time, TODO to cache resource table on client
    switch(state.mode) {
        case state.Mode.Selection:
            switch(body.name) {
                case 'Resource':
                    state.updateInventory(body.data.referenceId, 1);
                    break;
                case 'Earth':
                    appendToLog(`Select Earth: ${body.name}`);
                    state.setFocusBody(body);
                    break;
                case 'Strucutre':
                    appendToLog(`Select Structure: ${body.name}`);
                    break;
            }
            break;
        case state.Mode.Build:
            switch(body.name) {
                case 'Resource':
                    appendToLog(`Resource Build: ${body.name}`);
                    //build miner
                    break;
                case 'Earth':
                    appendToLog(`Earth Build: ${body.name} ${JSON.stringify(intersection.point)}`);
                    //build factory
                    break;
                case 'Structure':
                    //upgrade 
                    appendToLog(`Structure Build: ${body.name}`);
                    break;

            }
            break;
        case state.Mode.Transport:
            appendToLog(`Transport not yet supported: ${body.name}`);
            break;
    }
}


function onDocumentKeyDown(event: KeyboardEvent) {
    if (event.key === 'm' || event.key === 'M') {
        state.setMode((state.mode + 1) % (Object.keys(state.Mode).length/2));
        appendToLog(`Mode changed to: ${state.Mode[state.mode]}`);
    }

    if (event.key === 't' || event.key === 'T') {
        console.log("test");
        // create empty invntory
        const invetoryUUID = utils.generateUUID()
        const inventoryJSON = {
            id:invetoryUUID,
            inventory: {}
        }
        utils.postToTable('inventory', inventoryJSON)

        //create body
        const bodyUUID = utils.generateUUID()
        const partialBody: Partial<Body> = {
            id: bodyUUID,
            name: 'Structure',
            position: new THREE.Vector3(1, 2, 3),
            data: {
                refernceId: "Factory",
                referenceTable: "Structure",
                inventoryId: invetoryUUID
            }
          };
        const bodyJSON = new Body(partialBody).toJSON()
        console.log(bodyJSON);
        utils.postToTable('inventory', bodyJSON)

        //utils.postToTable('test', bodyJSON);
    }

}

document.addEventListener('keydown', onDocumentKeyDown, false);

document.addEventListener('click', onDocumentMouseClick, false);

function onDocumentMouseMove(event: MouseEvent) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(state.bodies.map(obj => obj.mesh));

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
    } else {
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
    state.bodies.forEach((obj) => {
        obj.update();    
    });
    renderer.render(scene, camera);
}
init();
