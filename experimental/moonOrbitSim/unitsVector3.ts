import * as THREE from 'three';
import { Measure, Length, Velocity, kilometers, seconds, GenericMeasure } from './units';

/**
 * Generic Vector3 wrapper with units
 * T is the unit type (Length, Velocity, etc.)
 */
export class MeasureVector3<T extends GenericMeasure<number, any, any>> {
    protected _vector: THREE.Vector3;
    protected _unit: GenericMeasure<number, any, any>;

    constructor(x: T, y: T, z: T, unit: GenericMeasure<number, any, any>) {
        this._unit = unit;
        // Convert all components to the specified unit
        const xValue = (x as GenericMeasure<number, any, any>).over(unit).value;
        const yValue = (y as GenericMeasure<number, any, any>).over(unit).value;
        const zValue = (z as GenericMeasure<number, any, any>).over(unit).value;
        this._vector = new THREE.Vector3(xValue, yValue, zValue);
    }

    /**
     * Get the underlying THREE.Vector3 (values in the stored unit)
     */
    getVector3(): THREE.Vector3 {
        return this._vector.clone();
    }

    /**
     * Get the unit being used
     */
    getUnit(): GenericMeasure<number, any, any> {
        return this._unit;
    }

    /**
     * Get the length (magnitude) as a Measure
     */
    length(): T {
        return Measure.of(this._vector.length(), this._unit) as T;
    }

    /**
     * Clone this vector
     */
    clone(): MeasureVector3<T> {
        return new MeasureVector3(this.getX(), this.getY(), this.getZ(), this._unit);
    }

    /**
     * Add another vector
     */
    add(other: MeasureVector3<T>): MeasureVector3<T> {
        const otherVec = other.getVector3();
        const result = this._vector.clone().add(otherVec);
        return this.fromVector3(result, this._unit);
    }

    /**
     * Subtract another vector
     */
    sub(other: MeasureVector3<T>): MeasureVector3<T> {
        const otherVec = other.getVector3();
        const result = this._vector.clone().sub(otherVec);
        return this.fromVector3(result, this._unit);
    }

    /**
     * Multiply by a scalar (dimensionless number)
     */
    multiplyScalar(scalar: number): MeasureVector3<T> {
        const result = this._vector.clone().multiplyScalar(scalar);
        return this.fromVector3(result, this._unit);
    }

    /**
     * Normalize (returns a dimensionless direction vector)
     */
    normalize(): THREE.Vector3 {
        return this._vector.clone().normalize();
    }

    /**
     * Copy values from another vector
     */
    copy(other: MeasureVector3<T>): MeasureVector3<T> {
        this._vector.copy(other.getVector3());
        return this;
    }

    /**
     * Get the squared length (magnitude squared) as a Measure
     */
    lengthSq(): T {
        const lengthSqValue = this._vector.lengthSq();
        // lengthSq has units squared, so we need to square the unit
        // For now, we'll return it as the same type measure (the value is already squared)
        return Measure.of(Math.sqrt(lengthSqValue), this._unit) as T;
    }

    /**
     * Dot product with another vector (returns dimensionless scalar)
     */
    dot(other: MeasureVector3<T>): number {
        const otherVec = other.getVector3();
        return this._vector.dot(otherVec);
    }

    /**
     * Cross product with another vector
     */
    cross(other: MeasureVector3<T>): MeasureVector3<T> {
        const otherVec = other.getVector3();
        const result = new THREE.Vector3().crossVectors(this._vector, otherVec);
        return this.fromVector3(result, this._unit);
    }

    /**
     * Cross product with a vector of different unit type
     * Used for angular momentum: r × v
     * Returns a MeasureVector3 with the same unit type as this vector
     */
    crossWith<U extends GenericMeasure<number, any, any>>(
        other: MeasureVector3<U>
    ): MeasureVector3<T> {
        const otherVec = other.getVector3();
        const result = new THREE.Vector3().crossVectors(this._vector, otherVec);
        // Return with the same unit as this vector
        return this.fromVector3(result, this._unit);
    }

    /**
     * Divide by a scalar (dimensionless number)
     */
    divideScalar(scalar: number): MeasureVector3<T> {
        const result = this._vector.clone().divideScalar(scalar);
        return this.fromVector3(result, this._unit);
    }

    /**
     * Negate this vector
     */
    negate(): MeasureVector3<T> {
        const result = this._vector.clone().negate();
        return this.fromVector3(result, this._unit);
    }

    /**
     * Add a scaled vector: this + other * scalar
     */
    addScaledVector(other: MeasureVector3<T>, scalar: number): MeasureVector3<T> {
        const otherVec = other.getVector3();
        const result = this._vector.clone().addScaledVector(otherVec, scalar);
        return this.fromVector3(result, this._unit);
    }

    /**
     * Distance to another vector
     */
    distanceTo(other: MeasureVector3<T>): T {
        const otherVec = other.getVector3();
        const distance = this._vector.distanceTo(otherVec);
        return Measure.of(distance, this._unit) as T;
    }

    /**
     * Squared distance to another vector
     */
    distanceToSquared(other: MeasureVector3<T>): T {
        const otherVec = other.getVector3();
        const distanceSq = this._vector.distanceToSquared(otherVec);
        return Measure.of(Math.sqrt(distanceSq), this._unit) as T;
    }

    /**
     * Normalize and return as the same type (unit vector with same units)
     */
    normalized(): MeasureVector3<T> {
        const normalized = this._vector.clone().normalize();
        return this.fromVector3(normalized, this._unit);
    }

    /**
     * Create from a plain THREE.Vector3 (assumes values are already in the unit)
     */
    protected fromVector3(vector: THREE.Vector3, unit: GenericMeasure<number, any, any>): MeasureVector3<T> {
        const x = Measure.of(vector.x, unit) as T;
        const y = Measure.of(vector.y, unit) as T;
        const z = Measure.of(vector.z, unit) as T;
        return new MeasureVector3(x, y, z, unit);
    }

    /**
     * Static method: Create from a plain THREE.Vector3
     */
    static fromVector3<T extends GenericMeasure<number, any, any>>(
        vector: THREE.Vector3,
        unit: GenericMeasure<number, any, any>
    ): MeasureVector3<T> {
        const x = Measure.of(vector.x, unit) as T;
        const y = Measure.of(vector.y, unit) as T;
        const z = Measure.of(vector.z, unit) as T;
        return new MeasureVector3(x, y, z, unit);
    }

    /**
     * Static method: Cross product of two vectors
     */
    static crossVectors<T extends GenericMeasure<number, any, any>>(
        a: MeasureVector3<T>,
        b: MeasureVector3<T>
    ): MeasureVector3<T> {
        const aVec = a.getVector3();
        const bVec = b.getVector3();
        const result = new THREE.Vector3().crossVectors(aVec, bVec);
        return MeasureVector3.fromVector3(result, a.getUnit());
    }

    /**
     * Static method: Cross product of length vector and velocity vector (for angular momentum)
     * Returns a MeasureVector3<Length> (angular momentum has units of length²/time, but we use Length for convenience)
     */
    static crossVectorsLengthVelocity(
        position: MeasureVector3<Length>,
        velocity: MeasureVector3<Velocity>
    ): MeasureVector3<Length> {
        const posVec = position.getVector3();
        const velVec = velocity.getVector3();
        const result = new THREE.Vector3().crossVectors(posVec, velVec);
        // Angular momentum has units of length²/time, but we'll return as Length for convenience
        return MeasureVector3.fromVector3<Length>(result, position.getUnit());
    }

    /**
     * Get x component as a Measure
     */
    getX(): T {
        return Measure.of(this._vector.x, this._unit) as T;
    }

    /**
     * Get y component as a Measure
     */
    getY(): T {
        return Measure.of(this._vector.y, this._unit) as T;
    }

    /**
     * Get z component as a Measure
     */
    getZ(): T {
        return Measure.of(this._vector.z, this._unit) as T;
    }

    /**
     * Update the vector from component Measures
     */
    set(x: T, y: T, z: T): void {
        this._vector.set(
            (x as GenericMeasure<number, any, any>).over(this._unit).value,
            (y as GenericMeasure<number, any, any>).over(this._unit).value,
            (z as GenericMeasure<number, any, any>).over(this._unit).value
        );
    }
}

/**
 * Type aliases for convenience
 */
export type LengthVector3 = MeasureVector3<Length>;
export type VelocityVector3 = MeasureVector3<Velocity>;

/**
 * Convenience constants for zero vectors
 */
export const ZERO_LENGTH_VECTOR3 = MeasureVector3.fromVector3<Length>(new THREE.Vector3(), kilometers);
export const ZERO_VELOCITY_VECTOR3 = MeasureVector3.fromVector3<Velocity>(new THREE.Vector3(), kilometers.per(seconds));
