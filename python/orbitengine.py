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

EARTH_RADIUS = const.R_earth.to(u.km)
T_ZERO = 0*u.s
T_INFINITY = sys.float_info.max*u.s
R_ZERO = [0,0,0]*u.km
V_ZERO = [0,0,0]*u.km/u.s
ROT_R_ZERO = [0,0,0]*u.rad
ROT_V_ZERO = [0,0,0]*u.rad/u.s
EPSILON = np.finfo(float).eps
PLANET_ICOSHPERE_LEVEL = 4
THRUST_MAX = 10.0*u.kg*u.m/u.s/u.s
MIMIMUM_MANEUVER_ALTITUDE = 20*u.km
TRAJECTORY_LAUNCH_MIN_ALTITUDE = EARTH_RADIUS/10
ROCKET_DRY_MASS = 10*u.kg
SPECIFIC_IMPULSE = 1000*u.s 
FUEL_MASS = 100*u.kg
FUEL_MASS_FLOW_RATE = 0.12*u.kg/u.s
G0 = (9.81*u.m/u.s**2).to(u.km/u.s**2)

INSERTION_BURN_TIME = 5.15
INSERTION_INTERPOLATION = 0.0

def debug(msg):
    #print call stack
    stack = inspect.stack()

    #print parent function name and file and line number
    print(f"{os.path.basename(stack[1].filename)}:{stack[1].lineno} {msg}")

def debug2(t,r,v):
    rs = ",".join([f"{x}" for x in r])
    vs = ",".join([f"{x}" for x in v])

    stack = inspect.stack()
    msg = f"t,r,v={t.value}*u.s, [{rs}]*u.km, [{vs}]*u.km/u.s"
    print(f"{os.path.basename(stack[1].filename)}:{stack[1].lineno} {msg}")

def formatTime(time):
    if time > 1000*u.year:
        return f"{time.to(u.year):.2e}"
    if time > 1*u.year:
        return f"{time.to(u.year):.2f}"
    if time > 1*u.day:
        return f"{time.to(u.day):.2f}"
    if time > 1*u.hour:
        return f"{time.to(u.hour):.2f}"
    if time > 1*u.min:
        return f"{time.to(u.min):.2f}"
    return f"{time.to(u.s):.2f}"

def formatDistance(distance):
    if distance > 9.461e+12*u.km:
        return f"{distance.to(u.km).value/9.461e+12:.2f} Lyr"
    elif distance > 1.079e+9*u.km:
        return f"{distance.to(u.km).value/1.079e+97:.2f} Lhr"
    elif distance > 299792*u.km:
        return f"{distance.to(u.km).value/299792:.2f} Ls"
    elif distance > 1000*u.km:
        return f"{distance.to(u.Mm):.2f}"
    elif distance > 1*u.km:
        return f"{distance.to(u.km):.2f}"
    else:
        return f"{distance.to(u.m):.2f}"

def formatVelocity(velocity):
    if velocity > 1000*u.km/u.s:
        return f"{velocity.to(u.Mm/u.s):.2f}"
    elif velocity > 1*u.km/u.s:
        return f"{velocity.to(u.km/u.s):.2f}"
    else:
        return f"{velocity.to(u.m/u.s):.2f}"

def formatAcceleration(acceleration):
    if acceleration > 1000*u.km/u.s**2:
        return f"{acceleration.to(u.Mm/u.s**2):.2f}"
    elif acceleration > 1*u.km/u.s:
        return f"{acceleration.to(u.km/u.s**2):.2f}"
    else:
        return f"{acceleration.to(u.m/u.s**2):.2f}"

def time_to_true_anomaly(t, a, e, mu):
    # Calculate the mean anomaly
    M = t / np.sqrt(a**3 / mu)

    # Solve Kepler's equation for the eccentric anomaly
    E = fsolve(lambda E: E - e * np.sin(E) - M, M)

    # Calculate the true anomaly
    nu = 2 * np.arctan(np.sqrt((1 + e) / (1 - e)) * np.tan(E / 2))

    return nu

def convertToEllipse(orbit, segments=100, t_start=0, t_end=1):
    # Get the orbital elements
    a = orbit.a.to(u.km).value  # semi-major axis
    e = orbit.ecc.value  # eccentricity
    i = orbit.inc.to(u.rad).value  # inclination
    raan = orbit.raan.to(u.rad).value  # longitude of the ascending node
    argp = orbit.argp.to(u.rad).value  # argument of periapsis

    # Compute the semi-minor axis
    b = a * np.sqrt(1 - e**2)

    # Compute the ellipse

#    t_end *= orbit.period.to(u.s).value
#    a_start = time_to_true_anomaly(t_start, a, e, orbit.attractor.k.to(u.km**3 / u.s**2).value)
#    a_end = time_to_true_anomaly(t_end, a, e, orbit.attractor.k.to(u.km**3 / u.s**2).value)
    theta = np.linspace(2*np.pi*t_start, 2*np.pi*t_end, segments)
#    theta = np.linspace(a_start, a_end, segments)
    x = a * np.cos(theta)
    y = b * np.sin(theta)

    # Shift the ellipse to the position of the orbit's focus
    # if i > np.pi/2:
    #     x += a * e
    # else:
    x -= a * e

    # Rotate the ellipse by the argument of periapsis
    x, y = x*np.cos(argp) - y*np.sin(argp), x*np.sin(argp) + y*np.cos(argp)

    # Rotate the ellipse by the inclination
    x, z = x, y*np.sin(i)
    y = y*np.cos(i)

    # Rotate the ellipse by the longitude of the ascending node
    x, y = x*np.cos(raan) - y*np.sin(raan), x*np.sin(raan) + y*np.cos(raan)

    #create list of points from x,y,z
    points = []
    for i in range(len(x)):
        points.append([x[i],y[i],z[i]])
    
    return points

def spherical_to_cartesian(r, theta, phi):
    x = r * np.sin(theta) * np.cos(phi)
    y = r * np.sin(theta) * np.sin(phi)
    z = r * np.cos(theta)
    return x, y, z

def line_sphere_intersection(P1, P2, C, r):
    # Compute the directional vector of the line
    d = P2 - P1

    # Compute the vector from the center of the sphere to P1
    f = P1 - C

    # Solve the quadratic equation
    a = np.dot(d, d)
    if a < EPSILON:
        return [(0,P1)]
    b = 2 * np.dot(f, d)
    c = np.dot(f, f) - r**2

    discriminant = b**2 - 4*a*c
    if discriminant < 0:
        # No intersection
        return []
    else:
        # Compute the two intersections
        t1 = (-b - np.sqrt(discriminant)) / (2*a)
        t2 = (-b + np.sqrt(discriminant)) / (2*a)

        # If the intersections are outside the line segment, discard them
        intersections = []
        if 0 <= t1 <= 1:
            intersections.append((t1, P1 + t1*d))
        if 0 <= t2 <= 1:
            intersections.append((t2, P1 + t2*d))

        return intersections



def func_twobody(t0, u_, k, ad, r0,v0):   
    """Differential equation for the initial value two body problem.

    This function follows Cowell's formulation from poliastro

    Parameters
    ----------
    t0 : float
        Time.
    u_ : ~numpy.ndarray
        Six component state vector [x, y, z, vx, vy, vz] (km, km/s).
    k : float
        Standard gravitational parameter.
    ad : function(t0, u, k)
         Non Keplerian acceleration (km/s2).

    """
    ax, ay, az, dm = ad(t0, u_, k, r0, v0)

    x, y, z, vx, vy, vz, mass = u_
    r3 = (x**2 + y**2 + z**2)**1.5

    du = np.array([
        vx,
        vy,
        vz,
        -k * x / r3 + ax,
        -k * y / r3 + ay,
        -k * z / r3 + az,
        dm
    ])

    return du

def cowell(k, r0, v0, m0, t, rtol=1e-10, *, ad=None, callback=None, nsteps=1000):
    x, y, z = r0.to(u.km).value
    vx, vy, vz = v0.to(u.km/u.s).value
    m = m0.to(u.kg).value
    u0 = np.array([x, y, z, vx, vy, vz, m])

    # Set the non Keplerian acceleration to zero by default
    if ad is None:
        ad = lambda t0, u_, k_, r0, v0: (0, 0, 0, 0)

    # Create an ode object
    rtol=1e-10
    nsteps=1000
    solver = ode(func_twobody).set_integrator('lsoda', method='bdf',rtol=rtol, nsteps=nsteps)  # Use VODE with BDF method
    solver.set_initial_value(u0)  # Set initial value at t=0
    solver.set_f_params(k.to(u.km**3/u.s**2).value, ad, r0, v0)  # Pass parameter k to the ODE function
    # Integrate the ODE at specific time points
    sol1 = solver.integrate(t.to(u.s).value)
    return sol1[0:3]*u.km, sol1[3:6]*u.km/u.s, sol1[6]*u.kg

# optimize lambert accounting for max_acceleration
def compute_totaldv(x, t_start, accel_max, orbit1, orbit2, time_weight, info):
    t_flight = x[0]*u.s
    if info[0] is not None:
        r1_prev, v1_prev, r2_prev, v2_prev, v1_sol_prev, v2_sol_prev, dv1_prev, dv2_prev = info[0]
        # burn time ratio
        # v1_prev_mag = np.linalg.norm(v1_prev)
        # v1_sol_prev_mag = np.linalg.norm(v1_sol_prev)
        # ratio = v1_prev_mag/(v1_prev_mag+v1_sol_prev_mag)
    else:
        dv1_prev = 0*u.m/u.s

    #compute effective start position using last v1_sol last v1 and accel_max
    if accel_max.value > EPSILON:
        t_burn1 = (dv1_prev/accel_max).to(u.s)
    else:
        t_burn1 = 0*u.s
        
    r1, v1 = orbit1.propagate(t_start + t_burn1/2)
    r2, v2 = orbit2.propagate(t_start + t_flight + t_burn1/2)

    res = list(iod.izzo.lambert(Earth.k, r1, r2, t_flight, M=0))
    if len(res) == 0 or len(res) > 1:
        raise RuntimeError(f"compute_totaldv labert produced {len(res)} solutions")

    v1_sol, v2_sol = res[0]
    dv1 = np.linalg.norm(v1 - v1_sol)
    dv2 = np.linalg.norm(v2 - v2_sol)
    info[0] = [r1, v1, r2, v2, v1_sol, v2_sol, dv1, dv2]
    return (dv1+dv2).value + time_weight*t_flight.value


def compute_dv(x0, orbit1, orbit2, info, launch=False):
    t_start, t_flight = x0
    t_start *= u.s
    t_flight *= u.s

    r1, v1, _, _, _ = orbit1.propagate(t_start)
    r2, v2, _, _, _ = orbit2.propagate(t_start + t_flight)

    res = list(iod.izzo.lambert(Earth.k, r1, r2, t_flight, M=0))
    if len(res) == 0 or len(res) > 1:
        raise RuntimeError(f"compute_totaldv labert produced {len(res)} solutions")

    v1_sol, v2_sol = res[0]

    # take off vector must be in director of normal vector for take off
    crash_penalty = 0
    if launch:
        normal_vec = r1/np.linalg.norm(r1)  #need to account for parent position        
        v1_sol_vec = v1_sol/np.linalg.norm(v1_sol)
        dot = np.dot(v1_sol_vec, normal_vec)
        if dot < 0.2:
            # float max creates bad numerical behavior :(
            crash_penalty = 10

    info[0] = [r1, v1, r2, v2, v1_sol, v2_sol]
    dv1 = np.linalg.norm(v1 - v1_sol)
    dv2 = np.linalg.norm(v2 - v2_sol)
    return  (dv1 + dv2).value+crash_penalty


class OrbitEngine:
    def __init__(self, renderer):
        self.bodies = []
        self.renderer = renderer

    def addBody(self, body):
        self.bodies.append(body)

    def bodyCount(self):
        return len(self.bodies)

    def update(self, time, dt, target):
        for i in range(len(self.bodies)):
            # for the target compute update precisely, otherwise estimate
            self.bodies[i].update(time, dt, estimate=target!=i)

    def setScale(self, cameraPos):
        for body in self.bodies:
            body.setScale(cameraPos)

    def getHUDInfo(self):
        text = ""
        for body in self.bodies:
            text += body.getHUDInfo()
        return text

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
                 r0=R_ZERO, 
                 v0=V_ZERO, 
                 rr0=ROT_R_ZERO,
                 rv0=ROT_V_ZERO,
                 m0=1*u.kg,
                 t0=T_ZERO, 
                 r1=None, 
                 v1=None, 
                 m1=None,
                 rr1=None,
                 rv1=None,
                 t1=T_INFINITY,
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
                 r0=R_ZERO, 
                 v0=V_ZERO, 
                 rr0=ROT_R_ZERO,
                 rv0=ROT_V_ZERO,
                 m0=1*u.kg,
                 t0=T_ZERO, 
                 r1=None, 
                 v1=None, 
                 rr1=None,
                 rv1=None,
                 m1=None,
                 t1=T_INFINITY,
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
        if self.accel_func is None and np.linalg.norm(np.cross(self.r0, self.v0).value) > EPSILON:
            kepler = Orbit.from_vectors(Earth, self.r0, self.v0)
            if kepler.r_a > 0 and kepler.r_p > 0:
                self.kepler = kepler

        self.computePeriodOrDuration()

    # launch acceleration function
    def acc_fun_launch(t, u_, k, r0, v0):
        r = u_[0:3]
        mass = u_[6]
        norm_vec = r/np.linalg.norm(r)
 
        dm = FUEL_MASS_FLOW_RATE.value
        if mass < ROCKET_DRY_MASS.value:
            dm = 0
        thrust = (G0*SPECIFIC_IMPULSE * dm).value
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
        i = INSERTION_INTERPOLATION
        #point anti normal slightly to kill vertical velocity
        thrust_vec = tangent_vec*(1-i) + normal_vec*i

        dm = FUEL_MASS_FLOW_RATE.value
        if mass < ROCKET_DRY_MASS.value:
            dm = 0
        thrust = (G0*SPECIFIC_IMPULSE * dm).value
        return np.concatenate((thrust_vec*thrust/mass, [-dm]))
    
    def computePeriodOrDuration(self):
        # compute properties of trajectory
        if self.type == TrajectorySegment.Type.POSITION_LOCKED:
            if self.rv0[0].value > EPSILON:
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
            thrust = G0*SPECIFIC_IMPULSE * FUEL_MASS_FLOW_RATE
            acc = thrust/self.body.mass - g
            self.period = np.sqrt(2*TRAJECTORY_LAUNCH_MIN_ALTITUDE/acc).to(u.s)

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
                intersections = line_sphere_intersection(r_prev.to(u.km).value, 
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
        r = spherical_to_cartesian(dist.to(u.km).value, theta, phi)

        theta = np.random.uniform(0,2*np.pi)
        phi = np.random.uniform(-np.pi/2,np.pi/2)
        v = spherical_to_cartesian(vel.to(u.km/u.s).value, theta, phi)
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
            for i in range(1,len(self.states)):
                t0 = self.states[i-1][0]
                t1 = self.states[i][0]
                if self.period is not None:
                    ts %= self.period                
                if t1 > ts:                    
                    interp = (ts-t0)/(t1-t0)
#                    print(f"interp {interp:.2f} t0:{t0:.2f} t1:{t1:.2f} ts:{ts:.2f} period:{self.period:.2f}")
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

            r,v,m = cowell(
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
                    r,v, m = cowell(
                        k=self.attractor.k,
                        r0=self.r0,
                        v0=self.v0, 
                        m0=self.m0,
                        t=ts, 
                        ad=self.accel_func)
                    return r, v, axis_quat.getHpr()*u.deg, w, m
            else:
                r,v,m = cowell(
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

class Body:
    class Type(Enum):
        PLANET = 0
        VESSEL = 1

    def __init__(self, 
                 type=Type.VESSEL,
                 name="Unamed", 
                 r0=R_ZERO, 
                 v0=V_ZERO, 
                 rr0=ROT_R_ZERO, 
                 rv0=ROT_V_ZERO, 
                 t_start=T_ZERO, 
                 mass_dry=1*u.kg,
                 mass_fuel0=0*u.kg,
                 parent=None, 
                 lockedPosition=False,
                 fixedScale=False):
        self.name = name
        self.k = mass_dry*(scipy.constants.G*u.m**3/u.kg/u.s**2).to(u.km**3/u.kg/u.s**2)
        self.lockedPosition = lockedPosition
        self.fixedScale = fixedScale
        self.type = type
        self.parent = parent
        self.trajectorySegments = []
        self.position = r0
        self.velocity = v0
        self.rotation = rr0
        self.w = [0,0,0]*u.rad/u.s
        self.target = None
        self.np = None
        self.velocity_np = None
        self.flag = False
        self.lastSegment = None
        self.lastTime = 0*u.s
        self.mass_fuel0 = mass_fuel0
        self.fuel_mass_flow_rate = FUEL_MASS_FLOW_RATE
        self.mass_dry = mass_dry
        self.mass_cargo = 0*u.kg
        self.mass = self.total_initial_mass()

        if lockedPosition:
            seg = TrajectorySegment(body=self,
                                    attractor=parent,
                                    r0=r0,
                                    v0=v0,
                                    rr0=rr0,
                                    rv0=rv0,
                                    t0=t_start,
                                    type=TrajectorySegment.Type.POSITION_LOCKED)
        elif np.linalg.norm(r0-self.parent.position) < self.parent.size + 1*u.m: # landed on that parent with 1m tolerance
            debug("Creating landed segment")
            seg = TrajectorySegment(body=self,
                                    attractor=parent,
                                    r0=r0,
                                    v0=v0,
                                    rr0=rr0,
                                    rv0=rv0,
                                    t0=t_start,
                                    m0=self.mass,
                                    type=TrajectorySegment.Type.LANDED)
        else:
            seg = TrajectorySegment(body=self,
                                    attractor=parent,
                                    r0=r0,
                                    v0=v0,
                                    rr0=rr0,
                                    rv0=rv0,
                                    t0=t_start,
                                    m0=self.mass,
                                    type=TrajectorySegment.Type.BALLISTIC)
        self.trajectorySegments.append(seg)

    def total_initial_mass(self):
        return self.mass_dry + self.mass_fuel0 + self.mass_cargo

    def setTarget(self, target):
        self.target = target

    def clearTrajectory(self):
        for seg in self.trajectorySegments:
            seg.clear()
        self.trajectorySegments = []

    def setScale(self,cameraPos):
        if self.np is None:
            return
        if self.fixedScale:
            return
        self.np.setScale(np.linalg.norm(self.position-cameraPos).to(u.km).value)

    def launch(self, t_start):
        r,v, rot, w, m = self.propagate(t_start)
        thickness = 2
        color = self.color

        # compute thrust
        # normal_vec = r-self.parent.position
        # alt = np.linalg.norm(normal_vec)
        # normal_vec = normal_vec/alt
        thrust = G0*SPECIFIC_IMPULSE * FUEL_MASS_FLOW_RATE        
        accel = thrust/self.mass
        if accel <= G0:
            debug(f"Net thurst accel is {accel.to(u.m/u.s**2):.3f}.  Lift off: FAILED")
            return
        debug(f"Net thurst accel is {accel.to(u.m/u.s**2):.3f}.  Lift off: SUCCESS")
 
        #launch trajectory
        t_launch_turn = t_start + 6*u.min
        seg_launch = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r,
                                v0=v,
                                t0=t_start,
                                m0=m,
                                t1=t_launch_turn,
                                accel_func=TrajectorySegment.acc_fun_launch,
                                type=TrajectorySegment.Type.LAUNCH,
                                segments=10)


        r1,v1, rot, w, m1 = seg_launch.propagate(t_launch_turn)
        seg_launch.r1 = r1
        seg_launch.v1 = v1
        seg_launch.m1 = m1
        seg_launch.t1 = t_launch_turn

        # add orbit insertion trajectory
        t_insertion_stop = t_launch_turn + INSERTION_BURN_TIME*u.min
        seg_insertion = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r1,
                                v0=v1,
                                m0=m1,
                                t0=seg_launch.t1,
                                t1=t_insertion_stop,
                                accel_func=TrajectorySegment.acc_fun_insertion,
                                type=TrajectorySegment.Type.BALLISTIC,
                                segments=25)
        
        r2, v2, rot, w, m2 = seg_insertion.propagate(t_insertion_stop)
        seg_insertion.r1 = r2
        seg_insertion.v1 = v2
        seg_insertion.m1 = m2
        seg_insertion.t1 = t_insertion_stop

        # add ballistic trajectory at the end of the luanch period
        seg_ballistic = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r2,
                                v0=v2,
                                m0=m2,
                                t0=t_insertion_stop,
                                type=TrajectorySegment.Type.BALLISTIC)


        self.clearTrajectory()
        self.trajectorySegments.append(seg_launch)
        self.trajectorySegments.append(seg_insertion)
        self.trajectorySegments.append(seg_ballistic)
        
        self.createTrajectoryGeometry(self.render, thickness, color)

    def propagate(self, t=0*u.s, estimate=False):

        if self.flag:
            debug("----------------------------------------------")
            for seg in self.trajectorySegments:
                debug(f"{self.name} t={t.value:.2f} segment t0:{seg.t0.value:.2f} t1:{seg.t1.value:.2f} m0:{seg.m0.value:.2f} m1:{seg.m1.value:.2f} {seg.type}")

        for seg in self.trajectorySegments:
            res = seg.propagate(t, estimate=estimate)
            if res is not None:
                self.lastSegment = seg
                return res

    def update(self, time, dt, estimate=False):

        # use trajectory np data to estimate position for fast rendering
        res = self.propagate(time, estimate=estimate)
        if res is None:
            return
        
        # hide the completed segments
        for seg in self.trajectorySegments:
            if seg.t1 < time:
                seg.np.hide()

        self.position, self.velocity, self.rotation, w, self.mass = res
        if self.np is None:
            return
        self.np.setPos(LVecBase3f(*self.position.to(u.km).value))
        self.np.setHpr(LVecBase3f(*self.rotation.to(u.deg).value))

        p1 = self.position.to(u.km).value
        p2 = p1 + self.velocity.to(u.km/u.s).value
#        p2 = self.position.to(u.km).value + 1000*self.velocity.to(u.km/u.s).value
        if self.velocity_np is not None:
            self.velocity_np.removeNode()
        self.velocity_np = NodePath(primatives.createLine(LVecBase3f(*p1), LVecBase3f(*p2), 2, self.color))
        self.velocity_np.reparentTo(self.render)

        self.lastTime = time

    def getHUDInfo(self):
        if self.parent is None:
            alt = 0*u.km
        else:
            alt = np.linalg.norm(self.position - self.parent.position) - self.parent.size

        text = f"{self.name}"+\
            f"  Alt: {formatDistance(alt)}"+ \
            f"  Vel: {formatVelocity(np.linalg.norm(self.velocity))}"
        
        if self.type == Body.Type.VESSEL:
            text += f"  Fuel: {self.mass - self.mass_dry:.2f}"
        text += '\n'

        if self.lastSegment is not None:
            if self.lastSegment != self.trajectorySegments[-1]: # last segment should be forever
                text += f"  Next Maneuver: {formatTime(self.lastSegment.t1-self.lastTime)}\n"    
        if self.target is not None:
            text += f"  Target: {self.target.name}"+\
                f"  Dist:{formatDistance(np.linalg.norm(self.position - self.target.position))}" + \
                f"  dV:{formatVelocity(np.linalg.norm(self.velocity - self.target.velocity))}\n"
        return text

    def setDeltaV(self, dv):
        self.deltaV = dv

    def setThrust(self, thrust):
        self.thrust = thrust

    def lambertSearch(self, t_start, target, launch=False, bounds=[None, None], resolution=5, show=False):

        per1 = self.trajectorySegments[0].period
        per2 = target.trajectorySegments[0].period
        per_max = 24*u.hour # default max period in case of non-keplerian orbits
        if per1 is not None and per2 is not None:
            per_max = np.max([per1.to(u.s).value,per2.to(u.s).value])
        elif bounds[0] is None and bounds[1] is None:
            debug(f"Warning: lambertSearch using default max period of {per_max}")

        if bounds[0] is None:
            bounds[0] = t_start.to(u.s).value + per_max
        if bounds[1] is None:
            bounds[1] = per_max

        # search for the starting point
        t_start = np.linspace(t_start.to(u.s).value, bounds[0], resolution)
        t_flight = np.linspace(1800, bounds[1], resolution)

        data = np.zeros((len(t_flight), len(t_start)))
        info = [None]
        for i in range(len(t_start)):
            for j in range(len(t_flight)):
                data[i, j] = compute_dv([t_start[i], t_flight[j]], self, target, info, launch)
        # Find the indices of the minimum value
        min_index = np.unravel_index(np.argmin(data), data.shape)
        min_value = data[min_index]
        guess = [t_start[min_index[0]], t_flight[min_index[1]]]

        if show:
            # Create the heat map
            plt.imshow(data, cmap='plasma', origin='lower', extent=[t_start.min(), t_start.max(), t_flight.min(), t_flight.max()])

            # Draw a dot on the minimum value
            plt.plot(t_start[min_index[1]], t_flight[min_index[0]], 'ro')

            # Uncomment the line below to add a colorbar
            # plt.colorbar(label='Value')

            plt.xlabel('t_flight')
            plt.ylabel('t_delay')
            plt.title('Energy')

            # Show the plot
            plt.show()

        return guess, min_value

    def computeInterceptManeuver2(self, t_start, target):

        solution_file = 'lambert.pkl'
        if os.path.exists(solution_file):
            with open(solution_file, 'rb') as f:
                data = pickle.load(f)
                t_transfer_start = data['t_delay']
                t_transfer_duration = data['t_flight']
                info = data['info']
        else:
            guess, min_value = self.lambertSearch(t_start, target, launch=True,resolution=50)
            debug(f"lambert guess: {guess} min_value: {min_value}")

            p1 = self.trajectorySegments[0].period.to(u.s).value
            p2 = target.trajectorySegments[0].period.to(u.s).value

            per = np.max([p1,p2])
            bounds = [(t_start.to(u.s).value, t_start.to(u.s).value + 2*per), (1,2*per)]

            info = [None]
            res = minimize(compute_dv, guess, args=(self, target, info, True), bounds=bounds)
            debug(f"minimize guess: {res.x} min_value: {res.fun}")

            t_transfer_start = res.x[0]*u.s
            t_transfer_duration = res.x[1]*u.s

            # save solution to disk
            with open(solution_file, 'wb') as f:
                pickle.dump({'t_delay':t_transfer_start, 't_flight':t_transfer_duration, 'info':info}, f)


        r1, v1, r2, v2, v1_sol, v2_sol = info[0]

        dv1 = np.linalg.norm(v1 - v1_sol)
        dv2 = np.linalg.norm(v2 - v2_sol)

        thrust = G0*SPECIFIC_IMPULSE * FUEL_MASS_FLOW_RATE
        accel_max = thrust/self.mass
        t_burn1 = (dv1/accel_max).to(u.s)
        t_burn2 = (dv2/accel_max).to(u.s)

        seg = self.trajectorySegments[-1]
        seg.t1 = t_transfer_start
        seg.r1 = r1
        seg.v1 = v1

        seg_transfer = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r1,
                                v0=v1_sol,
                                t0=t_transfer_start,
                                r1=r2,
                                v1= v2_sol,
                                t1=t_transfer_start + t_transfer_duration,
                                type=TrajectorySegment.Type.BALLISTIC)
    
        seg_target = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r2,
                                v0=v2,
                                t0=t_transfer_start + t_transfer_duration,
                                type=TrajectorySegment.Type.BALLISTIC)


        # get the burn points


        t_burn1_start = t_transfer_start-t_burn1/2
        t_burn1_stop = t_transfer_start+t_burn1/2
        accel_burn1 = (v1_sol - v1)/t_burn1
        r_burn1_start, v_burn1_start, rot, w, m = seg.propagate(t_burn1_start)
        r_burn1_stop, v_burn1_stop, rot, w, m = seg_transfer.propagate(t_burn1_stop)

        t_burn2_start = t_transfer_start+t_transfer_duration-t_burn2/2
        t_burn2_stop = t_transfer_start+t_transfer_duration+t_burn2/2
        accel_burn2 = (v2-v2_sol)/t_burn2
        r_burn2_start, v_burn2_start, rot, w, m = seg_transfer.propagate(t_burn2_start)
        r_burn2_stop, v_burn2_stop, rot, w, m = seg_target.propagate(t_burn2_stop)


        #adjust end of current trajectory
        # idealized trajectories
        seg.t1 = t_burn1_start
        seg.r1 = r_burn1_start
        seg.v1 = v_burn1_start
        
        seg_burn1 = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r_burn1_start,
                                v0=v_burn1_start,
                                t0=t_burn1_start,
                                r1=r_burn1_stop,
                                v1=v_burn1_stop,
                                t1=t_burn1_stop,
                                accel=accel_burn1,
                                type=TrajectorySegment.Type.BALLISTIC)
        


        # accel aware trajectories
        seg_transfer = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r_burn1_stop,
                                v0=v_burn1_stop,
                                t0=t_burn1_stop,
                                r1=r_burn2_start,
                                v1=v_burn2_start,
                                t1=t_burn2_start,
                                type=TrajectorySegment.Type.BALLISTIC)
    


        seg_burn2 = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r_burn2_start,
                                v0=v_burn2_start,
                                t0=t_burn2_start,
                                r1=r_burn2_stop,
                                v1=v_burn2_stop,
                                t1=t_burn2_stop,
                                accel=accel_burn2,
                                type=TrajectorySegment.Type.BALLISTIC)

        seg_target = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r_burn2_stop,
                                v0=v_burn2_stop,
                                t0=t_burn2_stop,
                                type=TrajectorySegment.Type.BALLISTIC)
 
        self.target = target
        self.trajectorySegments.append(seg_burn1)
        self.trajectorySegments.append(seg_transfer)
        self.trajectorySegments.append(seg_burn2)
        self.trajectorySegments.append(seg_target)

        for s in self.trajectorySegments:
            debug(f"{s.t0:.2f} {s.t1:.2f} {s.type}")
        self.createTrajectoryGeometry(self.render, thickness=2, color=self.color)


    def computeInterceptManeuverFromLaunch(self, t_start, orbit2):
        self.orbit.r_launch = self.position
        self.orbit.v_launch = self.velocity

        #accelation is normal to surface of attractor
        r_attractor = [0,0,0]*u.km
        acc = (self.orbit.r_launch - r_attractor)
        acc_vector = acc/np.linalg.norm(acc)
        thrust = G0*SPECIFIC_IMPULSE * FUEL_MASS_FLOW_RATE        
        self.thrust = acc_vector*thrust
        acc = self.thrust/self.mass
        t_launch = np.sqrt(2*(MIMIMUM_MANEUVER_ALTITUDE/np.linalg.norm(acc)).to(u.s**2))

        v = self.orbit.v_launch + acc*t_launch
        r = self.orbit.r_launch + self.orbit.v_launch*t_launch + 0.5*acc*t_launch**2
        self.landed = False

        self.orbit.set(self.parent, r, v, t_start + t_launch)
        self.computeInterceptManeuver(t_start + t_launch, orbit2, t_launch=t_launch)

    def computeInterceptManeuver(self, t_start, orbit2, t_launch=0.0*u.s):
        if self.landed:
            self.computeInterceptManeuverFromLaunch(t_start, orbit2)
            return

        # Initial guess for the parameters
        t_flight = 1*u.s # initial guess
        t_weight = 1e-6  # let user adjust this?
        x0 = np.array([t_flight.value])
        r1, v1 = self.orbit.propagate(t_start)

        # Define the bounds for the parameters
        bounds = [(1, None)]
        ts_start = time.time()
        info = [None]
        thrust = G0*SPECIFIC_IMPULSE * FUEL_MASS_FLOW_RATE
        accel_max = thrust/self.mass

        # find trajectory assuming instant velocity change
        options = {'maxiter':35}

        result = minimize(compute_totaldv, x0, args=(t_start, 0*u.m/u.s**2, self.orbit, orbit2, t_weight, info), bounds=bounds, options=options)
        t_flight = result.x[0]*u.s

        # do it again but with accel_max considered
        x0 = result.x.copy()
        result = minimize(compute_totaldv, x0, args=(t_start, accel_max, self.orbit, orbit2, t_weight, info), bounds=bounds, options=options)

        t_flight = result.x[0]*u.s
        r1, v1, r2, v2, v1_sol, v2_sol, dv1, dv2 = info[0]
        t_burn1 = (dv1/accel_max).to(u.s)
        t_burn2 = (dv2/accel_max).to(u.s)

        if result.nfev == 0:
            debug(result.message)

        if t_burn1/2 + t_burn2/2 > t_flight:
            debug(f"{t_burn1/2}+{t_burn2/2} > {t_flight} - not enough thrust to execute this trajectory!!!!!!!!")
            return
        ts_stop = time.time()
#        debug(f"Trajectory optimzation Time: {ts_stop-ts_start:.2f}")
        ts_start = time.time()

        r,v = self.orbit.computePseudoManouverTrajectory(r1,v1,r2,v2,v1_sol, v2_sol,
                                                               t_flight, color=self.color, 
                                                               t_start=t_start, 
                                                               thickness=5, 
                                                               t_launch=t_launch)
        ts_stop = time.time()
 #       debug(f"PseudoManouver geometery Time: {ts_stop-ts_start:.2f}")

        if self.orbit.collision:
            debug("orbit causes collision!!!")
    
    def randomize(self, dist, vel, time=0*u.s, type=TrajectorySegment.Type.BALLISTIC, createGeometry=True):
        self.clearTrajectory()
        seg = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=self.position,
                                v0=self.velocity,
                                t0=time,
                                m0=self.total_initial_mass(),
                                type=type)
        seg.randomize(dist, vel, time=time)
        self.trajectorySegments.append(seg)
        if createGeometry:
            self.createTrajectoryGeometry(self.render, thickness=2, color=self.color)

    def createTrajectoryGeometry(self, render=None, thickness=2, color=None):
        if render is None:
            render = self.render

        if color is None:
            color = self.color

        collision = False
        for seg in self.trajectorySegments:
            collision = seg.createGeometry(render=render, thickness=thickness, color=color)

        #add final trajectory segment on planet surface
        if collision:
            self.addCollisionTrjaectory(render, thickness=thickness, color=color)

    def addCollisionTrjaectory(self, render, thickness=2, color=None):
        if color is None:
            color = self.color
        seg = self.trajectorySegments[-1]
        seg_new = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=seg.r1,
                                v0=seg.v1,
                                m0=seg.m1,
                                rr0=seg.rr1,
                                rv0=seg.rv1,
                                t0=seg.t1,
                                type=TrajectorySegment.Type.LANDED)
        self.trajectorySegments.append(seg_new)
        seg_new.createGeometry(render=render, thickness=thickness, color=color)

    def createGeometry(self, render, type=Type.VESSEL, size=0.01*u.km, color=LVecBase4f(1,1,1,1)):
        self.color = color
        self.render = render
        self.size = size
        if type == Body.Type.VESSEL:
            self.fixedScale = False # allow scalling to camera distance
            data = primatives.createPyramid(size.to(u.km).value, color)
            self.np = NodePath(data)
        if type == Body.Type.PLANET:
            self.fixedScale = True #at some point, should convert to icon
            data = primatives.createIcosphere(size.to(u.km).value, PLANET_ICOSHPERE_LEVEL, color)
            # rotate so the icosphere is aligned with the z axis
            self.np = NodePath(data)
            self.np.setRenderModeWireframe()

            #draw pole axis
            axis_data = primatives.createLine(LVecBase3f(0,0,size.to(u.km).value*0.8), 
                                              LVecBase3f(0,0,size.to(u.km).value*1.2), 2, color)
            axis_np = NodePath(axis_data)
            axis_np.reparentTo(self.np)

        self.np.reparentTo(render)

    def showTrajectory(self, show=True):
        for seg in self.trajectorySegments:
            if seg.np is not None:
                if show:
                    seg.np.show()
                else:
                    seg.np.hide()
