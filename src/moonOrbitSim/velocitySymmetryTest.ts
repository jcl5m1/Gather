
import { OrbitalBody } from './orbitalBody';
import { Trajectory } from './trajectory';
import { seconds, kilometers } from './units';
import { calculateEllipticalVelocity } from './orbitUtils';
import * as THREE from 'three';

export function checkVelocitySymmetry(body: OrbitalBody): string {
    const trajectory = body.getTrajectory();
    if (!trajectory) return "No trajectory";

    let report = "Velocity Symmetry Report:\n";

    // Check 10 points from 0 to 0.5 (Apoapsis to Periapsis)
    // Symmetry should be at 1-t (Periapsis to Apoapsis)

    const steps = 10;

    const params = trajectory.getParameters();
    const periodParam = params.period;
    if (!periodParam) return "No period";
    const T = periodParam.over(seconds).value;
    const startTime = (trajectory as any)._startTime || 0;

    const aVal = (params._a as any).over(kilometers).value;
    const eVal = params.e;
    const initPos = (trajectory as any)._initialPosition;
    const initVel = (trajectory as any)._initialVelocity;
    const mass = (trajectory as any)._centralBodyMass;

    const n = 2 * Math.PI / T;
    const M0 = (trajectory as any)._cachedOrbitBasis.M0;

    for (let i = 1; i < steps; i++) {
        const t1 = (i / steps) * 0.5; // 0.05, 0.1, ... 0.45
        const t2 = 1.0 - t1;          // 0.95, 0.9, ... 0.55

        // Calculate exact times for these normalized coordinates
        // M_apo = (M_peri_norm + 0.5) % 1.
        // t = (M_peri_norm + 0.5) % 1

        let M_peri_norm_1 = t1 - 0.5;
        if (M_peri_norm_1 < 0) M_peri_norm_1 += 1.0;

        let M_peri_norm_2 = t2 - 0.5;
        if (M_peri_norm_2 < 0) M_peri_norm_2 += 1.0;

        const M_peri_1 = M_peri_norm_1 * 2 * Math.PI;
        const dt1 = (M_peri_1 - M0) / n;
        // Adjust dt to be positive for cleaner reading (though math works either way)
        // dt might be negative if M_peri < M0.
        // Let's ensure time is > startTime.
        let time1 = startTime + dt1;
        while (time1 < startTime) time1 += T;

        const M_peri_2 = M_peri_norm_2 * 2 * Math.PI;
        const dt2 = (M_peri_2 - M0) / n;
        let time2 = startTime + dt2;
        while (time2 < startTime) time2 += T;

        // Now get states
        const s1 = trajectory.getBezierState(time1, { calcVelocity: true });
        const s2 = trajectory.getBezierState(time2, { calcVelocity: true });

        // Analytical Velocity
        const vAna1Vec = calculateEllipticalVelocity(
            time1, aVal, eVal, T, startTime, initPos, initVel, mass
        );
        const vAna2Vec = calculateEllipticalVelocity(
            time2, aVal, eVal, T, startTime, initPos, initVel, mass
        );
        const vAna1 = vAna1Vec.length();
        const vAna2 = vAna2Vec.length();

        report += `\n--- Point ${i} (t=${t1.toFixed(4)} vs ${t2.toFixed(4)}) ---\n`;
        report += `Ana Mag: ${vAna1.toFixed(6)} vs ${vAna2.toFixed(6)}\n`;

        if (s1.velocity && s2.velocity) {
            const v1 = s1.velocity.length();
            const v2 = s2.velocity.length();
            const err1 = Math.abs(v1 - vAna1);
            const err2 = Math.abs(v2 - vAna2);

            report += `Bez Mag: ${v1.toFixed(6)} vs ${v2.toFixed(6)}\n`;
            report += `Error:   ${err1.toExponential(4)} vs ${err2.toExponential(4)}\n`;

            // Check symmetry of error
            const diffError = Math.abs(err1 - err2);
            report += `ErrDiff: ${diffError.toExponential(4)}\n`;

            if (diffError > 1e-4) {
                report += ">> ASYMMETRY DETECTED\n";
            }
        } else {
            report += "Velocity null\n";
        }
    }

    return report;
}
