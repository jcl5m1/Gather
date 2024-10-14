import * as THREE from 'three';

export class Resource {
    color: string = '';
    id:    string = '';
    name:  string = '';
    unit:  string = '';
    [property: string]: any;


    constructor(init: Partial<Resource>) {
        Object.assign(this, init);
      }

    toJSON(): any {
        return {
            color: this.color,
            id: this.id,
            name: this.name,
            unit: this.unit,
            ...Object.keys(this)
                .filter(key => !['color', 'id', 'name', 'unit'].includes(key))
                .reduce((obj, key) => {
                    obj[key] = this[key];
                    return obj;
                }, {} as { [key: string]: any })
        };
    }

    static fromJSON(json: string): Resource {
        const data = JSON.parse(json);
        return new Resource(data);
    }
}