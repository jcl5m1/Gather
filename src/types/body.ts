import * as THREE from 'three';

export function Vector3fromJSON(json: any): THREE.Vector3 {
  return new THREE.Vector3(json.x, json.y, json.z);
}

export function Vector3toJSON(vector: THREE.Vector3): any {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

export function toJSON<T extends object>(obj: T): any {
  const json: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = (obj as any)[key];
      if (value instanceof THREE.Vector3) {
        json[key] = Vector3toJSON(value);
      } else {
        json[key] = value;
      }
    }
  }
  return json;
}


// function fromJSON(json: any): Body {
//   const obj = new Body({});
//   for (const key in json) {
//     if (json.hasOwnProperty(key)) {
//       const value = json[key];
//       if (value && typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value) {
//         (obj as any)[key] = Vector3fromJSON(value);
//       } else {
//         (obj as any)[key] = value;
//       }
//     }
//   }
//   return obj;
// }

export function fromJSON<T extends object>(json: any, cls: new () => T): T {
  const obj = new cls();
  for (const key in json) {
    if (json.hasOwnProperty(key)) {
      const value = json[key];
      if (value && typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value) {
        (obj as any)[key] = Vector3fromJSON(value);
      } else {
        (obj as any)[key] = value;
      }
    }
  }
  return obj;
}


export class Body {
  angularVelocity: THREE.Vector3 = new THREE.Vector3();
  attached: boolean = false;
  id: string = '';
  mass: number = 1.0;
  name: string = 'unidentifed';
  parentId: string = '';
  position: THREE.Vector3 = new THREE.Vector3();
  radius: number = 1.0;
  data: any = {};
  timestamp: number = 0;
  velocity: THREE.Vector3 = new THREE.Vector3();
  [property: string]: any;

  constructor(init: Partial<Body>) {
    Object.assign(this, init);
  }

  static fromJSON(json: any): Body {
//    return fromJSON(json, Body);
    const obj = new Body({});
    for (const key in json) {
      if (json.hasOwnProperty(key)) {
        const value = json[key];
        if (value && typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value) {
          (obj as any)[key] = Vector3fromJSON(value);
        } else {
          (obj as any)[key] = value;
        }
      }
    }
    return obj;
  }

  toJSON(): any {
    return toJSON(this);
  }
}
