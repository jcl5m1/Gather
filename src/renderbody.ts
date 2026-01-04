import * as THREE from 'three';
import { appendToLog } from './utils'; // Assuming you have a utility function for logging
import config from './config.json';
import * as state from './state';

// Legacy Body class for deprecated code
class Body {
    position: THREE.Vector3 = new THREE.Vector3();
    velocity: THREE.Vector3 = new THREE.Vector3();
    angularVelocity: THREE.Vector3 = new THREE.Vector3();
    id: string = '';
    name: string = '';
    parentId: string = '';
    attached: boolean = false;
    radius: number = 1.0;
    data: any = {};
    
    constructor(init: Partial<Body>) {
        Object.assign(this, init);
    }
    
    toJSON(): any {
        return {
            position: { x: this.position.x, y: this.position.y, z: this.position.z },
            velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
            angularVelocity: { x: this.angularVelocity.x, y: this.angularVelocity.y, z: this.angularVelocity.z },
            id: this.id,
            name: this.name,
            parentId: this.parentId,
            attached: this.attached,
            radius: this.radius,
            data: this.data
        };
    }
    
    static fromJSON(json: any): Body {
        return new Body({
            position: new THREE.Vector3(json.position?.x || 0, json.position?.y || 0, json.position?.z || 0),
            velocity: new THREE.Vector3(json.velocity?.x || 0, json.velocity?.y || 0, json.velocity?.z || 0),
            angularVelocity: new THREE.Vector3(json.angularVelocity?.x || 0, json.angularVelocity?.y || 0, json.angularVelocity?.z || 0),
            id: json.id || '',
            name: json.name || '',
            parentId: json.parentId || '',
            attached: json.attached || false,
            radius: json.radius || 1.0,
            data: json.data || {}
        });
    }
}

export class RenderBody extends Body {
    mesh: THREE.Mesh = new THREE.Mesh();
    color: string = '';
    shape: string = 'cube';

    constructor(init: Partial<Body>) {
        super(init);
    }

    toJSON() {
        return super.toJSON();
    }

    static fromJSON(json: any) {
        let rb = new RenderBody(super.fromJSON(json));
        rb.color = json.color;
        rb.shape = json.shape;
        rb.createMesh();
        return rb;
    }

    createMesh() {
        let geometry: THREE.BufferGeometry;

        switch (this.shape) {
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
        const colorValue = parseInt(this.color.replace(/^#/, ''), 16);
        let material = new THREE.MeshPhongMaterial({ color: colorValue, flatShading: true , wireframe: config.RENDER_WIREFRAME});
        if (this.name === "Earth") {

            state.setFocusBody(this);

            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(config.EARTH_TEXTURE_URL, (earthTexture) => {
                material = new THREE.MeshPhongMaterial({
                    map: earthTexture,
                    shininess: 10
                });
                if (this.mesh) {
                    this.mesh.material = material; // Update the material after the texture is loaded
                }
            }, undefined, (error) => {
                appendToLog(`Error loading Earth texture: ${error}`);
            });
        }
        this.mesh = new THREE.Mesh(geometry, material);
        if (this.mesh) {
            this.mesh.position.set(this.position.x, this.position.y, this.position.z);
        }

        if (this.parentId) {
            const parentObject = state.bodies.find(o => o.id === this.parentId);
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
        if (this.mesh) {
            this.mesh.position.set(this.position.x, this.position.y, this.position.z);
        }

        const axis = this.angularVelocity.clone().normalize();
        const angle = this.angularVelocity.length()*1.0;

        const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        if (this.mesh) {
            this.mesh.quaternion.multiplyQuaternions(quaternion, this.mesh.quaternion);
        }
    }
}
