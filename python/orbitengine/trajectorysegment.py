from astropy import units as u
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
import numpy as np
from astropy import constants as const
from poliastro import iod
from scipy.optimize import fsolve
from scipy.spatial.transform import Rotation
import primatives
from panda3d.core import LVecBase4f, NodePath, LVecBase3f,GeomVertexReader, GeomVertexWriter, GeomVertexData, GeomTriangles, GeomNode, LQuaternion, Vec3
from enum import Enum
import math
from scipy.optimize import minimize
import scipy.constants

from poliastro.bodies import Earth, Mars, Sun  # Or your desired bodies
from poliastro.maneuver import Maneuver
from poliastro.twobody import Orbit
import poliastro as pa
import sys
import matplotlib.pyplot as plt
import numpy as np  # For array manipulation
import os
import inspect
import time
from scipy.integrate import ode
import json
import pickle
import orbitengine.engine as oe
from orbitengine.engine import debug

class TrajectorySegment:
    class Type(Enum):
        POSITION_LOCKED = 0
        LANDED = 1
        THRUST = 2
        BALLISTIC = 3
        LAUNCH = 4
 
    def __init__(self, 
                 body=None, 
                 attractor=None, 
                 r0=oe.R_ZERO, 
                 v0=oe.V_ZERO, 
                 rr0=oe.ROT_R_ZERO,
                 rv0=oe.ROT_V_ZERO,
                 m0=1*u.kg,
                 t0=oe.T_ZERO, 
                 r1=None, 
                 v1=None, 
                 m1=None,
                 rr1=None,
                 rv1=None,
                 t1=oe.T_INFINITY,
                 accel_func=None,
                 type=Type.POSITION_LOCKED,
                 segments=100):
        self.set(body=body, 
                 attractor=attractor, 
                 r0=r0, 
                 v0=v0, 
                 rr0=rr0, 
                 rv0=rv0, 
                 m0=m0,
                 t0=t0, 
                 r1=r1, 
                 v1=v1, 
                 rr1=rr1,
                 rv1=rv1, 
                 m1=m1,
                 t1=t1,
                 accel_func=accel_func,
                 type=type,
                 segments=segments)

    def set(self, 
                 body=None, 
                 attractor=None, 
                 r0=oe.R_ZERO, 
                 v0=oe.V_ZERO, 
                 rr0=oe.ROT_R_ZERO,
                 rv0=oe.ROT_V_ZERO,
                 m0=1*u.kg,
                 t0=oe.T_ZERO, 
                 r1=None, 
                 v1=None, 
                 rr1=None,
                 rv1=None,
                 m1=None,
                 t1=oe.T_INFINITY,
                 accel_func=None,
                 type=Type.POSITION_LOCKED,
                 segments=100):
        self.type = type
        self.body = body
        self.attractor = attractor

        # entry state
        self.r0 = r0
        self.v0 = v0
        self.t0 = t0*1 #break reference
        self.rr0=rr0
        self.rv0=rv0
        self.m0 = m0
        self.segments = segments

        # exit state
        if r1 is None:
            self.r1 = r0
        else:
            self.r1 = r1
        
        if v1 is None:
            self.v1 = v0
        else:
            self.v1 = v1
        
        if rr1 is None:
            self.rr1 = rr0
        else:
            self.rr1 = rr1

        if rv1 is None:
            self.rv1 = rv0
        else:
            self.rv1 = rv1

        if m1 is None:
            self.m1 = m0
        else:
            self.m1 = m1
            
        self.t1 = t1*1

        self.accel_func = accel_func

        self.states = []
        self.np = None
        self.period = None
        self.collision = False
        self.collision_np = None

        if self.attractor is not None:
            #check if the entry state should be landed
            if type != TrajectorySegment.Type.LAUNCH:
                if self.attractor.size.to(u.m) + 1*u.m > np.linalg.norm(self.r0):
                    self.collision = True
                    type = TrajectorySegment.Type.LANDED

        # try kepler orbit if no acceleration and valid parameters
        # poliastro kepler solver is very picky, local cowell solver is more flexible
        # kepler does not handle acceleration and requires lateral velocity
        self.kepler = None
        if self.accel_func is None and np.linalg.norm(np.cross(self.r0, self.v0).value) > oe.EPSILON:
            kepler = Orbit.from_vectors(Earth, self.r0, self.v0)
            if kepler.r_a > 0 and kepler.r_p > 0:
                self.kepler = kepler

        self.computePeriodOrDuration()

    # launch acceleration function
    def acc_fun_launch(t, u_, k, r0, v0):
        r = u_[0:3]
        mass = u_[6]
        norm_vec = r/np.linalg.norm(r)
 
        dm = oe.REACTION_MASS_FLOW_RATE.value
        if mass < oe.ROCKET_DRY_MASS.value:
            dm = 0
        thrust = (oe.EARTH_G0*oe.SPECIFIC_IMPULSE_TYPE.Liquid * dm).value
        return np.concatenate((norm_vec*thrust/mass, [-dm]))

    # launch acceleration function
    def acc_fun_insertion(t, u_, k, r0, v0):
        r = u_[0:3]
        v = u_[3:6]
        mass = u_[6]
        
#        tangent_vec = np.cross(np.cross(r, v),r) # current tanget direction
        tangent_vec = np.cross(np.cross(r0, v0),r0) #initial tangent vector
        tangent_vec = tangent_vec/np.linalg.norm(tangent_vec)
        
        normal_vec = r/np.linalg.norm(r)
        i = oe.INSERTION_INTERPOLATION
        #point anti normal slightly to kill vertical velocity
        thrust_vec = tangent_vec*(1-i) + normal_vec*i

        dm = oe.REACTION_MASS_FLOW_RATE.value
        if mass < oe.ROCKET_DRY_MASS.value:
            dm = 0
        thrust = (oe.EARTH_G0*oe.SPECIFIC_IMPULSE_TYPE.Liquid * dm).value
        return np.concatenate((thrust_vec*thrust/mass, [-dm]))
    
    def computePeriodOrDuration(self):
        # compute properties of trajectory
        if self.type == TrajectorySegment.Type.POSITION_LOCKED:
            if self.rv0[0].value > oe.EPSILON:
                self.period = self.t0 + (360*u.deg/self.rv0[0]).to(u.s)

        elif self.type == TrajectorySegment.Type.LANDED:
            self.period = self.attractor.trajectorySegments[0].period

        elif self.type == TrajectorySegment.Type.BALLISTIC:
            # Compute the magnitudes of the initial position and velocity vectors
            r = np.linalg.norm(self.r0)
            v = np.linalg.norm(self.v0)

            # Compute the semi-major axis
            a = 1 / (2/r - v**2/self.attractor.k)

            self.period = None

            if a > 0*u.km and self.accel_func is None:
                # Compute the period of the orbit
                self.period = 2 * np.pi * np.sqrt(a**3 / self.attractor.k)
        elif self.type == TrajectorySegment.Type.LAUNCH:
            # compute time to reach target altitude
            alt = np.linalg.norm(self.r0 - self.attractor.position)
            g = self.attractor.k/alt**2
            thrust = oe.EARTH_G0*oe.SPECIFIC_IMPULSE_TYPE.Liquid * oe.REACTION_MASS_FLOW_RATE
            acc = thrust/self.body.mass - g
            self.period = np.sqrt(2*oe.TRAJECTORY_LAUNCH_MIN_ALTITUDE/acc).to(u.s)

    def createGeometry(self, render=None, thickness=2, color=LVecBase4f(0,1,0,1)):                
        self.color = color
        self.thickness = thickness
        TRAJECTORY_NONPERIODIC_TIME_LIMIT = 4*u.hour
        if render is None:
            render = self.body.render

        if self.type == TrajectorySegment.Type.POSITION_LOCKED:
            return
        
        elif self.type == TrajectorySegment.Type.LANDED:
            steps = self.segments
            t_stop = self.t1 
            if self.t0+self.period < t_stop:
                t_stop = self.t0 + self.period
            times = np.linspace(self.t0, t_stop, steps)

        elif self.type == TrajectorySegment.Type.BALLISTIC:
            t_stop = self.t1 
            if self.period is None:
                #hyperbolic orbit, non-elliptical
                if t_stop - self.t0 > TRAJECTORY_NONPERIODIC_TIME_LIMIT:
                    t_stop = self.t0 + TRAJECTORY_NONPERIODIC_TIME_LIMIT
                    debug(f"non-periodic segment too long, truncating to {TRAJECTORY_NONPERIODIC_TIME_LIMIT}")
            else:
                if self.t0+self.period < t_stop:
                    t_stop = self.t0+self.period
            steps = self.segments
            times = np.linspace(self.t0, t_stop, steps)

        elif self.type == TrajectorySegment.Type.LAUNCH:
            t_stop = self.t1
            steps = self.segments
            times = np.linspace(self.t0, t_stop, steps)

        positions = []
        self.states = []
        t_last = self.t0
        v_last = self.v0
        r_last = self.r0
        m_last = self.m0
        for t in times:
            res = self.propagate(t)
            if res is None:
                debug(f"trajectory segment propagate failed: {t} -> {res}")
                break
            r,v,rot,w,m = res
            collision_res = self.checkCollision(r, r_last, render)
            if collision_res is not None:
                i, rc = collision_res
                vc = v_last*(1-i) + v*i
                tc = t_last*(1-i) + t*i
                mc = m_last*(1-i) + m*i
                self.r1 = rc*u.km
                self.v1 = vc
                self.t1 = tc
                self.m1 = mc
                positions.append(rc)
                self.states.append([tc-self.t0, rc, vc, rot, w, mc])  #rot and w not used yet
                break
            
            positions.append(r.value)
            self.states.append([t-self.t0, r, v, rot, w, m])
            r_last = r
            v_last = v
            t_last = t
            m_last = m

        if self.np is not None:
            self.np.removeNode()
        path = primatives.createLineList(positions, close=False, color=color, thickness=thickness)
        self.np = NodePath(path)
        self.np.reparentTo(render)
        return self.collision and (self.type == TrajectorySegment.Type.BALLISTIC)

    def setCollisionPoint(self, render, position):
        if self.collision_np is not None:
            self.collision_np.removeNode()
        self.collision_np = NodePath(primatives.createCube(0.005,color=LVecBase4f(1,0,0,1)))
        self.collision_np.setPos(LVecBase3f(*position))
        self.collision_np.reparentTo(render)

    def checkCollision(self, r, r_prev=None, render=None):
        if self.type != TrajectorySegment.Type.BALLISTIC:
            return None
        
        r_mag = np.linalg.norm(r).to(u.m)
        attractor_size = self.attractor.size.to(u.m)

        if r_mag < attractor_size - 1*u.m:
            self.collision = True
            if r_prev is None or np.linalg.norm(r_prev).to(u.m) < attractor_size-1*u.m:
                r *= attractor_size/r_mag
                self.setCollisionPoint(render, r.to(u.km).value)
                return 0, r.to(u.km).value
            else:
                intersections = oe.line_sphere_intersection(r_prev.to(u.km).value, 
                                                        r.to(u.km).value, 
                                                        self.attractor.position.to(u.km).value, 
                                                        self.attractor.size.to(u.km).value)
                if len(intersections) == 0:
                    debug(f"no intersection - r:{r_mag} r:{np.linalg.norm(r_prev).to(u.m)} attractor:{self.attractor.size.to(u.m)}")
                    r *= attractor_size/r_mag
                    intersections = [0, r.to(u.km).value]
                self.setCollisionPoint(render, intersections[0][1])
            return intersections[0]
        return None

    def randomize(self, dist, vel, time=0*u.s):
        # random 3d unit vector
        theta = np.random.uniform(0,2*np.pi)
        phi = np.random.uniform(-np.pi/2,np.pi/2)
        r = oe.spherical_to_cartesian(dist.to(u.km).value, theta, phi)

        theta = np.random.uniform(0,2*np.pi)
        phi = np.random.uniform(-np.pi/2,np.pi/2)
        v = oe.spherical_to_cartesian(vel.to(u.km/u.s).value, theta, phi)
        r = r*u.km
        if self.attractor is not None:
            r += self.attractor.position
        v = v*u.km/u.s
        self.t0 = time*1
        self.r0 = r
        self.v0 = v
        return r, v

    def propagate(self, t=0*u.s, estimate=False):

        if t < self.t0:
            return None
        if t > self.t1:
            return None
        
        if self.t0 == self.t1:
            return self.r0, self.v0, self.rr0, self.rv0, self.m0


        ts = t.to(u.s)-self.t0


        # use trajectory samples to estimate position
        if estimate:
            t_end = self.t1
            if self.period is not None:
                ts %= self.period
                t_end = self.t0 + self.period
            # try to guess the start index to minimize search
            guess_i = int(self.segments*ts.value/(t_end-self.t0).value)
            for i in range(guess_i, len(self.states)):
                t0 = self.states[i-1][0]
                t1 = self.states[i][0]
                if t1 > ts:
                    interp = (ts-t0)/(t1-t0)
#                    debug(f"ts:{ts:.2f} t1:{t1:.2f} estimate i:{i} guess_i:{guess_i}")
                    state0 = self.states[i-1]
                    state1 = self.states[i]
                    res = []
                    for e in range(1,len(state0)):
                        if e == 4:
                            # angular velocity is special stucture
                            w = [state0[e][0]*(1-interp) + state1[e][0]*interp, 
                                 state0[e][1]*(1-interp) + state1[e][1]*interp, 
                                 state0[e][2]*(1-interp) + state1[e][2]*interp]
                            res.append(w)
                        else:
                            res.append(state0[e]*(1-interp) + state1[e]*interp)
                    return res


        #propagate rotation
        axis_quat = LQuaternion()
        axis_quat.setHpr(Vec3(*self.rr0.value))
        axis_vec = Vec3(0,0,1)
        axis_vec = axis_quat.xform(axis_vec)

        rotation_quat = LQuaternion()
        #providing axis angle is helpful for calculating children
        w = [self.rv0[0], axis_vec, ts]
    
        if self.type == TrajectorySegment.Type.POSITION_LOCKED:
            ts %= self.period
            rotation_quat.setFromAxisAngle((w[0]*ts).value, w[1])
            axis_quat *= rotation_quat
            return self.r0, self.v0, axis_quat.getHpr()*u.deg, w, self.m0

        if self.type == TrajectorySegment.Type.LANDED:
            ts %= self.period
            rotation_quat.setFromAxisAngle((w[0]*ts).value, w[1])
            axis_quat *= rotation_quat
            #adjust position an velocity for rotation based on rotation of the parent
            pr, pv, p_rot, pw, pm = self.body.parent.propagate(ts)
            
            p_rot_angle = pw[0]*pw[2]
            p_quat = LQuaternion()
            p_quat.setFromAxisAngle(p_rot_angle.value, pw[1])
            r = p_quat.xform(Vec3(*self.r0.value))*u.km
            # reset height to ground level is below ground
            altitude = np.linalg.norm(r-self.body.parent.position)
            if altitude < self.body.parent.size + 1*u.m:
                r *= self.body.parent.size/altitude

            w2_axis = np.array([*pw[1]])
            w2_mag = pw[0].to(u.rad/u.s)
            v = np.cross(w2_axis*w2_mag, r).value*u.km/u.s #for conversion to km/s?
            return r, v, axis_quat.getHpr()*u.deg, p_quat, self.m0

        if self.type == TrajectorySegment.Type.LAUNCH:

            r,v,m = oe.cowell(
                k=self.attractor.k,
                r0=self.r0,
                v0=self.v0, 
                m0=self.m0,
                t=ts, 
                ad=self.accel_func)
            return r, v, axis_quat.getHpr()*u.deg, w, m

            # # vec is normal to the planet
            # vec = self.r0 - self.body.parent.position
            # alt = np.linalg.norm(vec)
            # vec = vec/alt
            # g = self.body.parent.k/alt**2
            # accel = self.body.thrust_max/self.body.mass - g.to(u.m/u.s/u.s)

            # # this set absolute max accel
            # if accel.value <= 0:
            #     accel = 0*u.m/u.s/u.s
            #     debug(f"net thurst accel {accel:.2f} not enough for lift off")

            # # need to check this is above the planet's accel
            # accel_vec = vec*accel
            # v = self.v0 + accel_vec*ts
            # r = self.r0 + self.v0*ts + 0.5*accel_vec*ts*ts
            # return r, v, axis_quat.getHpr()*u.deg, w

        if self.type == TrajectorySegment.Type.BALLISTIC:
            if self.kepler is not None:
                ts %= self.kepler.period
                try:
                    r,v = self.kepler.propagate(ts).rv()
                    return r, v, axis_quat.getHpr()*u.deg, w, self.m0
                except RuntimeError as e:
                    debug(f"{e}  -----------------------------")
                    r,v, m = oe.cowell(
                        k=self.attractor.k,
                        r0=self.r0,
                        v0=self.v0, 
                        m0=self.m0,
                        t=ts, 
                        ad=self.accel_func)
                    return r, v, axis_quat.getHpr()*u.deg, w, m
            else:
                r,v,m = oe.cowell(
                    k=self.attractor.k,
                    r0=self.r0,
                    v0=self.v0, 
                    m0=self.m0,
                    t=ts, 
                    ad=self.accel_func)
                return r, v, axis_quat.getHpr()*u.deg, w, m
        debug("propagate un recognized segment type")
        return None
    
    def clear(self):
        if self.np is not None:
            self.np.removeNode()
        if self.collision_np is not None:
            self.collision_np.removeNode()
