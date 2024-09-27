import * as THREE from 'three';

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const cursorGeometry = new THREE.SphereGeometry(100, 5, 5);
const cursorMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const cursor = new THREE.Mesh(cursorGeometry, cursorMaterial);
const currentHost = `http://${window.location.hostname}:8010`;


class Body {
    id:string;
    name: string;
    color: string;
    radius: GLfloat;
    shape: string;
    mass: GLfloat;
    parent: string;
    attached: boolean;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    angularVelocity: THREE.Vector3;
    mesh: THREE.Mesh;

    static fromJSON(json: any): Body {
        return new Body(
            json.id,
            json.name,
            json.color,
            json.radius,
            json.mass,
            json.shape,
            json.parent,
            json.attached,
            new THREE.Vector3(parseFloat(json.position.x), parseFloat(json.position.y), parseFloat(json.position.z)),
            new THREE.Vector3(parseFloat(json.velocity.x), parseFloat(json.velocity.y), parseFloat(json.velocity.z)),
            new THREE.Vector3(parseFloat(json.angularVelocity.x), parseFloat(json.angularVelocity.y), parseFloat(json.angularVelocity.z)),
        );
    }

    toJSON(): any {
        return {
            id: this.id,
            name: this.name,
            radius: this.radius,
            mass: this.mass,
            color: this.color,
            parent: this.parent,
            attached: this.attached,
            position: {
                x: this.position.x,
                y: this.position.y,
                z: this.position.z
            },
            velocity: {
                x: this.velocity.x,
                y: this.velocity.y,
                z: this.velocity.z
            },
            angularVelocity: {
                x: this.angularVelocity.x,
                y: this.angularVelocity.y,
                z: this.angularVelocity.z
            }
        };
    }

    constructor(id: string,
        name: string, 
        color: string, 
        radius: GLfloat, 
        mass: GLfloat,         
        shape: string,
        parent: string,        
        attached: boolean,
        position: THREE.Vector3, 
        velocity: THREE.Vector3, 
        angularVelocity: THREE.Vector3) {
        this.id = id;
        this.name = name;
        this.radius = radius;
        this.mass = mass;
        this.color = color;
        this.shape = shape;
        this.parent = parent;
        this.attached = attached;
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
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);
    }

    update() {
        if (this.attached) {
            return;
        }
        this.position.add(this.velocity);
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);

        const axis = this.angularVelocity.clone().normalize();
        const angle = this.angularVelocity.length()*100.0;

        const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        this.mesh.quaternion.multiplyQuaternions(quaternion, this.mesh.quaternion);
    }
}   

let objects: Body[] = [];

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

    scene.add(cursor);


    animate();
    
    fetch(`${currentHost}/api/object`)
        .then(response => response.json())
        .then(data => {

            let earth: Body;

            data.forEach((item: any, index: number) => {
                let obj = Body.fromJSON(item);


                objects.push(obj);
                // const nameDiv = document.createElement('div');
                // nameDiv.style.position = 'absolute';
                // nameDiv.style.top = `${10 + index * 30}px`;
                // nameDiv.style.left = '10px';
                // nameDiv.style.color = 'white';
                // nameDiv.style.fontSize = '20px';
                // nameDiv.style.fontFamily = 'Arial';
                // nameDiv.innerText = `Object: ${item.name}`;
                // document.body.appendChild(nameDiv);
                scene.add(obj.mesh);
                console.log(`Added object: ${obj.name}`);
            });

            //for each object that is attached add mesh to parent mesh
            //for some reason this is does not work if you do it in the previous loop
            objects.forEach((obj) => {
                if (obj.attached) {
                    const parentObject = objects.find(o => o.id == obj.parent);
                    if (parentObject) {
                        parentObject.mesh.add(obj.mesh);
                    }
                }
            });



        })
        .catch(error => {
            console.error('Error fetching object names:', error);
        });
}


function onDocumentMouseClick(event: MouseEvent) {

    //find object named earth
    const earth = objects.find(o => o.name == "Earth");
    if (!earth) {
        console.error('Earth object not found');
        return;
    }
    const newObject = new Body(
        "",
        'Item',
        '#00ff00',
        100,
        1,
        'sphere',
        earth.id,
        true,
        cursor.position.clone(),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0)
    );
    objects.push(newObject);
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

function onDocumentMouseMove(event: MouseEvent) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(objects.map(obj => obj.mesh));

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
