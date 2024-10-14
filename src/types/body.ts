import * as THREE from 'three';


export class Body {
  angularVelocity: THREE.Vector3 = new THREE.Vector3();
  attached: boolean = false;
  color: string = '';
  id: string = '';
  mass: number = 1.0;
  name: string = 'unidentifed';
  parentId: string = '';
  position: THREE.Vector3 = new THREE.Vector3();
  radius: number = 1.0;
  referenceId: string = '';
  referenceTable: string = '';
  shape: string = 'cube';
  timestamp: number = 0;
  velocity: THREE.Vector3 = new THREE.Vector3();
  [property: string]: any;

  constructor(init: Partial<Body>) {
    Object.assign(this, init);
  }

  static fromJSON(json: any): Body {
    return new Body({
      angularVelocity: new THREE.Vector3(
        json["angularVelocity"].x,
        json["angularVelocity"].y,
        json["angularVelocity"].z
      ),
      attached: json["attached"],
      color: json["color"],
      id: json["id"],
      mass: json["mass"],
      name: json["name"],
      parentId: json["parentId"],
      position: new THREE.Vector3(
        json["position"].x,
        json["position"].y,
        json["position"].z
      ),
      radius: json["radius"],
      referenceId: json["referenceId"],
      referenceTable: json["referenceTable"],
      shape: json["shape"],
      timestamp: json["timestamp"],
      velocity: new THREE.Vector3(
        json["velocity"].x,
        json["velocity"].y,
        json["velocity"].z
      ),
    });
  }

  toJSON(): any {
    return {
      angularVelocity: {
        x: this.angularVelocity.x,
        y: this.angularVelocity.y,
        z: this.angularVelocity.z,
      },
      attached: this.attached,
      color: this.color,
      id: this.id,
      mass: this.mass,
      name: this.name,
      parentId: this.parentId,
      position: {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      },
      radius: this.radius,
      referenceId: this.referenceId,
      referenceTable: this.referenceTable,
      shape: this.shape,
      timestamp: this.timestamp,
      velocity: {
        x: this.velocity.x,
        y: this.velocity.y,
        z: this.velocity.z,
      },
    };
  }
}
