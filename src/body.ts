import * as THREE from 'three';
import { appendToLog } from './utils'; // Assuming you have a utility function for logging
import config from './config.json';
import * as state from './state';

export class Body {
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

        let geometry: THREE.BufferGeometry;

        switch (shape) {
            case 'Icosahedron':
                geometry = new THREE.IcosahedronGeometry(this.radius, 10);
                break;
            case 'Box':
                geometry = new THREE.BoxGeometry(this.radius, this.radius, this.radius);
                break;
            case 'Cylinder':
                geometry = new THREE.CylinderGeometry(this.radius, this.radius, this.radius * 2, 16);
                break;
            case 'Cone':
                geometry = new THREE.ConeGeometry(this.radius, this.radius * 2, 16);
                break;
            case 'Arrowhead':
                geometry = new THREE.ConeGeometry(this.radius, this.radius * 2, 3);
                break;
            case 'Pyramid':
                geometry = new THREE.ConeGeometry(this.radius, this.radius * 2, 4);
                break;
            case 'Diamond':
                geometry = new THREE.OctahedronGeometry(this.radius);
                break;
            case 'Torus':
                geometry = new THREE.TorusGeometry(this.radius, this.radius / 2, 16, 100);
                break;
            case 'Torus Knot':
                geometry = new THREE.TorusKnotGeometry(this.radius, this.radius / 2, 100, 16);
                break;
            case 'Dodecahedron':
                geometry = new THREE.DodecahedronGeometry(this.radius);
                break;
            case 'Octahedron':
                geometry = new THREE.OctahedronGeometry(this.radius);
                break;
            case 'Icosahedron':
                geometry = new THREE.IcosahedronGeometry(this.radius);
                break;
            case 'Tetrahedron':
                geometry = new THREE.TetrahedronGeometry(this.radius);
                break;
            case 'Plane':
                geometry = new THREE.PlaneGeometry(this.radius, this.radius);
                break;
            case 'Ring':
                geometry = new THREE.RingGeometry(this.radius / 2, this.radius, 32);
                break;
            case 'Circle':
                geometry = new THREE.CircleGeometry(this.radius, 32);
                break;
            default:
                geometry = new THREE.BoxGeometry(this.radius, this.radius, this.radius);
                break;
        }

        //convert color string to THREE.Color
        const colorValue = parseInt(color.replace(/^#/, ''), 16);
        let material = new THREE.MeshPhongMaterial({ color: colorValue, flatShading: true , wireframe: config.RENDER_WIREFRAME});
        if (name === "Earth") {

            state.setFocusBody(this);

            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(config.EARTH_TEXTURE_URL, (earthTexture) => {
                material = new THREE.MeshPhongMaterial({
                    map: earthTexture,
                    shininess: 10
                });
                this.mesh.material = material; // Update the material after the texture is loaded
            }, undefined, (error) => {
                appendToLog(`Error loading Earth texture: ${error}`);
            });
        }
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);

        if (this.parent) {
            const parentObject = state.bodies.find(o => o.id === this.parent);
            if (parentObject) {
            const direction = new THREE.Vector3().subVectors(parentObject.position, this.position).normalize();
            const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
            this.mesh.quaternion.copy(quaternion);
            }
        }
    }

    update() {
        if (this.attached) {
            return;
        }
        this.position.add(this.velocity);
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);

        const axis = this.angularVelocity.clone().normalize();
        const angle = this.angularVelocity.length()*1.0;

        const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        this.mesh.quaternion.multiplyQuaternions(quaternion, this.mesh.quaternion);
    }
}   