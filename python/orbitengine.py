from astropy import units as u
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
import numpy as np
from astropy import constants as const
from poliastro import iod
from scipy.optimize import fsolve
from scipy.spatial.transform import Rotation
import primatives
from panda3d.core import LVecBase4f, NodePath, LVecBase3f,GeomVertexWriter, GeomVertexData, GeomTriangles, GeomNode
from enum import Enum
import math
from scipy.optimize import minimize

from poliastro.bodies import Earth, Mars, Sun  # Or your desired bodies
from poliastro.maneuver import Maneuver
from poliastro.twobody import Orbit
import poliastro as pa

import matplotlib.pyplot as plt
import numpy as np  # For array manipulation
import os
import inspect
import time
from scipy.integrate import ode

EARTH_RADIUS = const.R_earth.to(u.km)

epsilon = np.finfo(float).eps

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
        return f"{distance/9.461e+12:.2f}Lyr"
    elif distance > 1.079e+9*u.km:
        return f"{distance/1.079e+97:.2f}Lhr"
    elif distance > 299792*u.km:
        return f"{distance.to(u.lightsec):.2f}"
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



def func_twobody(t0, u_, k, ad):   
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
    ax, ay, az = ad(t0, u_, k)

    x, y, z, vx, vy, vz = u_
    r3 = (x**2 + y**2 + z**2)**1.5

    du = np.array([
        vx,
        vy,
        vz,
        -k * x / r3 + ax,
        -k * y / r3 + ay,
        -k * z / r3 + az
    ])

    return du

def cowell(k, r0, v0, tof, rtol=1e-10, *, ad=None, callback=None, nsteps=1000):
    x, y, z = r0.to(u.km).value
    vx, vy, vz = v0.to(u.km/u.s).value
    u0 = np.array([x, y, z, vx, vy, vz])

    # Set the non Keplerian acceleration
    if ad is None:
        ad = lambda t0, u_, k_: (0, 0, 0)

    # Create an ode object
    rtol=1e-10
    nsteps=1000
    solver = ode(func_twobody).set_integrator('lsoda', method='bdf',rtol=rtol, nsteps=nsteps)  # Use VODE with BDF method
    solver.set_initial_value(u0)  # Set initial value at t=0
    solver.set_f_params(k.to(u.km**3/u.s**2).value, ad)  # Pass parameter k to the ODE function
    # Integrate the ODE at specific time points
    sol1 = solver.integrate(tof.to(u.s).value)
    return sol1[:3]*u.km, sol1[3:]*u.km/u.s

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
    if accel_max.value > epsilon:
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

class BodyType(Enum):
    PLANET = 0
    VESSEL = 1

class OrbitEngine:
    def __init__(self, renderer):
        self.bodies = []
        self.renderer = renderer

    def addBody(self, body):
        self.bodies.append(body)

    def computeLambert(self):
        pass

    def update(self, time, dt):
        for body in self.bodies:
            body.update(time, dt)

    def setScale(self, cameraPos):
        for body in self.bodies:
            body.setScale(cameraPos)

    def getHUDInfo(self):
        info = ""
        for body in self.bodies:
            info += body.getHUDInfo() + "\n"
        return info

class BodyOrbit:
    def __init__(self, body, r0, v0, render=None, attractor=Earth, time=0*u.s,segments=0, width=2,  color=LVecBase4f(1,1,1,1)):
        self.body = body
        self.color = color
        self.render = render
        self.np = None
        self.prev_np = None
        self.manuever_np = None
        self.collision = False
        self.collision_np = None
        self.trajectory_state = []
        self.set(attractor, r0,v0, time=time, segments=segments)

    def set(self, attractor, r0,v0, time=0*u.s, segments=0):

        self.attractor = attractor
        self.r0 = r0
        self.v0 = v0
        self.startTime = time*1  #breaks the reference to the simulator time, which otherwise would causes the update to not move
        h = np.cross(r0, v0)

        if np.linalg.norm(h).value > epsilon:
            self.kepler = Orbit.from_vectors(attractor, r0, v0)
            if self.kepler.r_a < 0 or self.kepler.r_p < 0:
                debug(f"invalid kepler orbit {self.kepler.r_a}, {self.kepler.r_p}")
                self.kepler = None
        else:
            self.kepler = None

        if segments > 0:
            t_end = time + 1*u.hour
            #if valid kepler orbit, find kepler orbit period
            if self.kepler is not None:
                t_end = time + self.kepler.period
            self.generatePath(time, t_end, segments)

        #use kepler orbit calculation, but this doesn't support hyperbolic or parabolic orbits and sometimes fails        
        # self.orbit = Orbit.from_vectors(attractor, r0, v0)
        # if segments > 0:
        #     if self.np is not None:
        #         self.np.removeNode()
        #     path = primatives.createLineList(convertToEllipse(self.orbit, segments), True, self.color)
        #     self.np = NodePath(path)
        #     self.np.reparentTo(self.render)
        #     self.periapsis = self.orbit.r_p.to(u.km)
        #     self.apoapsis = self.orbit.r_a.to(u.km)
        #the *1 breaks the reference to the simulator time, which otherwise would mean the update does not move
    def __str__(self):
        return f"BodyOrbit r0:{self.r0} v0:{self.v0} startTime:{self.startTime}"

    def generatePath(self, t_start, t_end, segments=50):
        pos = []
        self.collision = False

        times = np.linspace(t_start, t_end, segments)
        for t in times:
            try:
                # r,v = pa.twobody.propagation.cowell(
                #     self.attractor.k.to(u.km**3 / u.s**2).value, 
                #     self.r0.to(u.km).value,
                #     self.v0.to(u.km/u.s).value,
                #     t.to(u.s).value)
                r,v = cowell(
                    self.attractor.k, 
                    self.r0,
                    self.v0,
                    t)
                self.collision = self.checkCollision(r) is not None
                if self.collision:
                    break
                pos.append(r.value)
            except RuntimeError as e:
                debug(f"{e}  break ------------------------------------------------------------")
                break

        
        if self.np is not None:
            self.np.removeNode()
        if len(pos) == 0:
            return
        path = primatives.createLineList(pos, close=False, color=self.color)
        self.np = NodePath(path)
        self.np.reparentTo(self.render)

    def randomize(self, dist, vel, time=0*u.s, segments=50):

        # random 3d unit vector
        theta = np.random.uniform(0,2*np.pi)
        phi = np.random.uniform(-np.pi/2,np.pi/2)
        r = spherical_to_cartesian(dist.to(u.km).value, theta, phi)

        theta = np.random.uniform(0,2*np.pi)
        phi = np.random.uniform(-np.pi/2,np.pi/2)
        v = spherical_to_cartesian(vel.to(u.km/u.s).value, theta, phi)
        r = r*u.km
        v = v*u.km/u.s

        self.set(Earth, r, v, time=time, segments=segments)

        if self.manuever_np is not None:
            self.manuever_np.removeNode()

        return r, v


    def setCollisionPoint(self, position):
        if self.collision_np is None or self.collision_np.is_empty():
            self.collision_np = NodePath(primatives.createCube(0.002,color=LVecBase4f(1,0,0,1)))
            self.collision_np.reparentTo(self.render)
        self.collision_np.setPos(LVecBase3f(*position))

    def clearManeuverVisualizations(self):
        self.trajectory_state = []
        if self.prev_np is not None:
            if not self.prev_np.is_empty():
                self.prev_np.removeNode()
        if self.manuever_np is not None:
            if not self.manuever_np.is_empty():
                self.manuever_np.removeNode()
        if self.collision_np is not None:
            if not self.collision_np.is_empty():
                self.collision_np.removeNode()

    # def computeCowellManouverTrajectory(self, maneuvers, color, t_start=0*u.s, thickness=5):
    #     pos = []
    #     self.collision = False
    #     def callback(t, state):            
    #         if self.collision:
    #             return
    #         rn = state[:3]  # Position vector
    #         vn = state[3:]  # Velocity vector
    #         if self.attractor.R.to(u.km).value + epsilon > np.linalg.norm(rn):
    #             self.collision = True
    #             intersections = line_sphere_intersection(pos[-1], rn, [0,0,0], self.attractor.R.to(u.km).value)
    #             self.setCollisionPoint(intersections[0][1])
    #             pos.append(intersections[0][1])
    #             return
    #         pos.append(rn.copy())

    #     #starting position and velocity
    #     r, v = self.propagate(t_start - self.startTime)
    #     r = r.to(u.km).value
    #     v = v.to(u.km/u.s).value

    #     #for each maneuver, compute the acceleration period and then the post acceleration period
    #     # and concatenate the results
    #     for m in maneuvers:
    #         accel, dt = m
    #         # Define the additional acceleration function
    #         def ad(t0, state, k):
    #             return accel.to(u.km/u.s**2).value

    #         r,v = pa.twobody.propagation.cowell(
    #             self.attractor.k.to(u.km**3 / u.s**2).value, 
    #             r, 
    #             v,
    #             dt.to(u.s).value,
    #             ad=ad, 
    #             callback=callback)

    #     if not self.collision:
    #         # extrapolate for 1 hour more for visualization
    #         pa.twobody.propagation.cowell(
    #             self.attractor.k.to(u.km**3 / u.s**2).value, 
    #             r, 
    #             v,
    #             1*3600,
    #             ad=None, 
    #             callback=callback)

    #     path = primatives.createLineList(pos, False, color, thickness)
    #     if self.manuever_np is not None:
    #         self.manuever_np.removeNode()
    #     self.manuever_np = NodePath(path)
    #     self.manuever_np.reparentTo(self.render)

    #     #final position and velocity
    #     return r*u.km, v*u.km/u.s

    def checkCollision(self, r, r_prev=None):
        if self.attractor.R.to(u.km).value + epsilon > np.linalg.norm(r).to(u.km).value:
            self.collision = True
            if r_prev is None:
                self.setCollisionPoint(r.to(u.km).value)
                return None
            else:
                intersections = line_sphere_intersection(r_prev.to(u.km).value, 
                                                        r.to(u.km).value, 
                                                        [0,0,0], # replace with attractor position 
                                                        self.attractor.R.to(u.km).value)
                if len(intersections) == 0:
                    return None
                self.setCollisionPoint(intersections[0][1])
            return intersections[0]
        return None

    # given lambert solution, create a psuedo manuever trajectory
    def computePseudoManouverTrajectory(self, r1, v1, r2, v2, v1_sol, v2_sol, t_flight, color, t_start, thickness=5, t_launch=0*u.s, segments=100):
        dv1 = v1_sol - v1
        dv2 = v2_sol - v2
        accel_max = self.body.thrust_max/self.body.mass
        t_burn1 = (np.linalg.norm(dv1)/accel_max).to(u.s)
        t_burn2 = (np.linalg.norm(dv2)/accel_max).to(u.s)

        # bezier style spline interpolation of orbit propogations 
        self.collision = False
        self.trajectory_state = []
        t_duration = t_burn1/2+ t_flight + t_burn2/2
        self.trajectory_params = [r1, v1, r2, v2, v1_sol, v2_sol, t_flight, t_start*1, t_burn1, t_burn2, t_launch]
        self.orbit_initial = BodyOrbit(self.body, r1, v1,self.render,self.attractor)
        self.orbit_transfer = BodyOrbit(self.body, r1, v1_sol, self.render,self.attractor) 
        self.orbit_final = BodyOrbit(self.body, r2, v2,self.render,self.attractor)

        # use propagate function        
        self.trajectory_state = []
        pos = []

        times = np.linspace(t_start-t_launch, t_start + t_duration, segments)
        for t in times:
            r,v = self.propagateManeuverTrajectory(t)
            if len(self.trajectory_state) > 0:
                t_prev, r_prev, v_prev = self.trajectory_state[-1]
                res = self.checkCollision(r, r_prev)
                # store interpolated position and velocity
                if res is not None:
                    i, rc = res
                    vc = v_prev*(1-i) + v*i
                    tc = t_prev*(1-i) + t*i
                    self.trajectory_state.append((tc, rc*u.km, vc))
                    break
            self.trajectory_state.append((t,r,v))

        for t,r,v in self.trajectory_state:
            pos.append(r.to(u.km).value)

        path = primatives.createLineList(pos, False, color, thickness)
        if self.manuever_np is not None:
            self.manuever_np.removeNode()
        self.manuever_np = NodePath(path)
        self.manuever_np.reparentTo(self.render)

        return self.trajectory_state[-1][1], self.trajectory_state[-1][2]
    
    def propagateManeuverTrajectory(self, t):
        r1, v1, r2, v2, v1_sol, v2_sol, t_flight, t_start, t_burn1, t_burn2, t_launch = self.trajectory_params
        ts = t-t_start+t_launch
        # dv1 = v1_sol - v1
        # dv2 = v2_sol - v2
        # accel_max = self.body.thrust_max/self.body.mass
        # t_burn1 = (np.linalg.norm(dv1)/accel_max).to(u.s)
        # t_burn2 = (np.linalg.norm(dv2)/accel_max).to(u.s)

        t_delay = 0*u.s
        t_burn1_start = t_delay + t_launch
        t_burn1_stop = t_burn1_start + t_burn1
        t_burn2_start = t_burn1_start + t_flight + t_burn1/2 - t_burn2/2
        t_burn2_stop = t_burn1_start + t_flight + t_burn1/2 + t_burn2/2
        try:
            if ts < t_burn1_start:
                #  (0,1)
                s = (ts-t_delay)/(t_launch)
                r = self.r_launch*(1-s*s) + r1*s*s  # simulate parabolic position
                v = self.v_launch*(1-s) + v1*s
                return r, v
            elif ts < t_burn1_stop:  
                # (0,1)
                s = (ts-t_burn1_start)/(t_burn1_stop-t_burn1_start)
                ra,va = self.orbit_initial.propagate((s-1)*t_burn1/2)
                rb,vb = self.orbit_transfer.propagate(s*t_burn1/2)
                rc = ra*(1-s) + rb*s
                vc = va*(1-s) + vb*s
                return rc, vc
            elif ts < t_burn2_start:
                #  (t_burn1/2, t_flight - t_burn2/2)
                s = ts-t_burn1/2
                return self.orbit_transfer.propagate(s)
            elif ts < t_burn2_stop:
                # (0,1)
                s = (ts - t_burn2_start)/(t_burn2_stop-t_burn2_start)
                ra,va = self.orbit_transfer.propagate(t_flight + (s-1)*t_burn2/2)
                rb,vb = self.orbit_final.propagate(s*t_burn2/2)
                rc = ra*(1-s) + rb*s
                vc = va*(1-s) + vb*s
                return rc, vc
            else:
                # t_burn2/2 ->
                s = ts-t_burn2_stop+t_burn2/2
                return self.orbit_final.propagate(s)
        except u.core.UnitConversionError as e:
            debug(f"{e} ------------------------------------------------------------")
            s = (ts-t_burn1_start)/(t_burn1_stop-t_burn1_start)
            ra,va = self.orbit_initial.propagate((s-1)*t_burn1/2)
            rb,vb = self.orbit_transfer.propagate(s*t_burn1/2)
            debug(f"t, ra,va: {s}, {ra}, {va}")
            debug(f"t, rb,vb: {s}, {rb}, {vb}")

    

    def setScale(self,cameraPos):
        if self.collision_np is not None:
            if not self.collision_np.is_empty():
                self.collision_np.setScale(np.linalg.norm(self.collision_np.getPos()-cameraPos.to(u.km).value))

    #copy np to prev_np
    def copyNP(self):
        if self.np is not None:
            if self.prev_np is not None:
                self.prev_np.removeNode()
            self.prev_np = self.np.copyTo(self.render)
        
    def propagate(self, t=0*u.s):
        try:
            if len(self.trajectory_state) > 0:
                return self.propagateManeuverTrajectory(t)
            else:
                # only use kepler if we have a valid elliptical orbit
                if self.kepler is not None and (self.kepler.r_a.value > 0 and self.kepler.r_p.value > 0):
#                    debug(f"kepler values {self.kepler.r_a.value}, {self.kepler.r_p.value}")
                    return self.kepler.propagate(t-self.startTime).rv()
                else:
                    # r,v = pa.twobody.propagation.cowell(
                    # self.attractor.k.to(u.km**3 / u.s**2).value, 
                    # self.r0.to(u.km).value,
                    # self.v0.to(u.km/u.s).value, 
                    # (t-self.startTime).to(u.s).value)
                    # return r*u.km, v*u.km/u.s

                    return cowell(
                    self.attractor.k, 
                    self.r0,
                    self.v0, 
                    (t-self.startTime))
        except RuntimeError as e:
            debug(f"{e} ------------------------------------------------------------")
            debug(f"t, r0,v0: {t}, {self.r0.value}*u.km,  {self.v0.value}*u.km/u.s")
        
class Body:
    def __init__(self, name, r0, v0, type, render,attractor=Earth, size=0.01, color=LVecBase4f(0,1,0,1)):
        self.name = name
        self.mass = 1*u.kg
        self.type = type
        self.color = color
        self.attractor = attractor
        self.thrust_max = 0*u.kg*u.m/u.s/u.s
        self.thrust = [0,0,0]*u.kg*u.m/u.s/u.s
        self.deltaV = [0,0,0]*u.m/u.s
        self.position = np.zeros((1,3))*u.km
        self.rotation = Rotation.identity()
        self.velocity = np.zeros((1,3))*u.m/u.s
        self.rotation_velocity = Rotation.identity()
        self.acceleration = np.zeros((1,3))
        self.rotation_acceleration = Rotation.identity()
        color2 = color/2
        self.orbit = BodyOrbit(self, r0, v0, 
                               render, attractor=attractor, 
                               color=color2, segments=100)

        pos, vel = self.orbit.propagate()
        self.landed = attractor.R.to(u.m).value + 1 > np.linalg.norm(pos.to(u.m).value)
        self.landedPrev = False

        if type == BodyType.VESSEL:
            ship = primatives.createPyramid(size, color)

            self.np = NodePath(ship)
            self.np.reparentTo(render)
            self.np.setPos(LVecBase3f(*pos.value))
            self.np.setHpr(0,-90,0)

        # velocity line
        # vel_line = primatives.createLine(LVecBase3f(*pos.value), LVecBase3f(*(pos.value+1000*vel.value)), 2, color)
        # self.vel_line_np = NodePath(vel_line)
        # self.vel_line_np.reparentTo(renderer)

    def setScale(self,cameraPos):
        self.np.setScale(np.linalg.norm(self.position-cameraPos).to(u.km).value)
        self.orbit.setScale(cameraPos)
        # self.orbit.apoapsis_np.setScale(np.linalg.norm(self.orbit.apoapsis_np.getPos()-cameraPos))
        # self.orbit.periapsis_np.setScale(np.linalg.norm(self.orbit.periapsis_np.getPos()-cameraPos))

    def update(self, time, dt):

        # if np.linalg.norm(self.thrust.value) >= epsilon:
        #     # if self.landed: # take off
        #     #     self.orbit.set(self.attractor,self.position, self.velocity, time, segments=0)
        #     pos, vel = self.orbit.propagate(time-dt)
        #     self.deltaV = self.thrust*dt/self.mass
        #     vel = vel + self.deltaV
        #     self.orbit.set(self.attractor,pos, vel, time)
        # else:
        if not self.landed: # flying
            pos, vel = self.orbit.propagate(time)
            self.position = pos.to(u.km)
            self.velocity = vel.to(u.m/u.s)
        elif not self.landedPrev:  # just landed
            pos, vel = self.orbit.propagate(time)
            #normlize pos to radius of attractor
            pos = self.attractor.R*pos/np.linalg.norm(pos)
            #velocity should match the surface rotation of attractor
            vel = [0,0,0]*u.m/u.s
            self.orbit.set(self.attractor,pos, vel, time, segments=0)
            self.position = pos.to(u.km)
            self.velocity = vel.to(u.m/u.s)

        self.np.setPos(LVecBase3f(*self.position.value))
        self.landedPrev = self.landed

        #1 meter tolerance for landing
        self.landed = self.attractor.R.to(u.m).value + 1 > np.linalg.norm(self.position.to(u.m).value)

    def getHUDInfo(self):
        return f"{self.name}\n"+\
            f" ThrustMax: {self.thrust_max:.2f}\n"+ \
            f" Alt: {formatDistance(np.linalg.norm(self.position))}\n"+ \
            f" Vel: {formatVelocity(np.linalg.norm(self.velocity))}\n"
    
    def setDeltaV(self, dv):
        self.deltaV = dv

    def setThrust(self, thrust):
        self.thrust = thrust

    def computeInterceptManeuverFromLaunch(self, t_start, orbit2):
        # get th
        MIMIMUM_MANEUVER_ALTITUDE = 20*u.km
        self.orbit.r_launch = self.position
        self.orbit.v_launch = self.velocity

        #accelation is normal to surface of attractor
        r_attractor = [0,0,0]*u.km
        acc = (self.orbit.r_launch - r_attractor)
        acc_vector = acc/np.linalg.norm(acc)
        self.thrust = acc_vector*self.thrust_max
        acc = self.thrust/self.mass
        t_launch = np.sqrt(2*(MIMIMUM_MANEUVER_ALTITUDE/np.linalg.norm(acc)).to(u.s**2))

        v = self.orbit.v_launch + acc*t_launch
        r = self.orbit.r_launch + self.orbit.v_launch*t_launch + 0.5*acc*t_launch**2
        self.landed = False

        self.orbit.set(self.attractor, r, v, t_start + t_launch)
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
        accel_max = self.thrust_max/self.mass

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
    
    def randomize(self, dist, vel, time=0*u.s, segments=50):
        r,v = self.orbit.randomize(dist, vel, time=time, segments=segments)
        self.position = r
        self.velocity = v

        # rs = ",".join([f"{i}" for i in r.to(u.km).value])
        # vs = ",".join([f"{i}" for i in v.to(u.km/u.s).value])
        # debug(f"randomized orbit: [{rs}]*u.km, [{vs}]*u.km/u.s,")

        self.landed = (dist.to(u.m).value < self.attractor.R.to(u.m).value +1)
        self.landedPrev = self.landed
        return r, v

