
import * as THREE from 'three';
import { Trajectory } from './src/moonOrbitSim/trajectory';
import { LengthVector3, VelocityVector3, Mass, Length, Time, kilometers, seconds, kilograms } from './src/moonOrbitSim/units';

// Mock scene and rendering
const scene = new THREE.Scene();
const trajectory = new Trajectory(scene);

// Setup an elliptical orbit
// Position: (10000, 0, 0) km
// Velocity: (0, 1.5, 0) km/s
const r = new THREE.Vector3(10000, 0, 0);
const v = new THREE.Vector3(0, 1.5, 0);
const centralMassValue = 5.972e24; // Earth mass
const centralMass = Mass.of(centralMassValue, kilograms);

const pos = LengthVector3.fromVector3(r, kilometers);
const vel = VelocityVector3.fromVector3(v, kilometersPerSecond);

// Need to import units correctly. Since we are running in node, we might need to adjust imports or mocks.
// But wait, the environment allows me to run typescript files if I compile them?
// Or I can just inspect the code logic.
// Actually, I can't easily run the code because of dependencies (THREE.js, etc).
// The 'run_command' tool can run shell commands. I don't have a full TS node runner setup guaranteed for this project structure.
// So I should rely on READING and ANALYZING code, or modifying the code to print debug info when the USER runs it (which they seem to be doing).
