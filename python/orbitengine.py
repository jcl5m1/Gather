from astropy import units as u
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
import numpy as np
from astropy import constants as const
from poliastro import iod
from scipy.optimize import fsolve
from scipy.spatial.transform import Rotation
import primatives
from panda3d.core import LVecBase4f, NodePath, LVecBase3f,GeomVertexWriter, GeomVertexData, GeomTriangles, GeomNode, LQuaternion, Vec3
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
TRAJECTORY_LAUNCH_MIN_ALTITUDE = EARTH_RADIUS/100

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


def compute_dv(x0, orbit1, orbit2, info):
    t_start, t_flight = x0
    t_start *= u.s
    t_flight *= u.s

    r1, v1, _, _ = orbit1.propagate(t_start)
    r2, v2, _, _ = orbit2.propagate(t_start + t_flight)

    res = list(iod.izzo.lambert(Earth.k, r1, r2, t_flight, M=0))
    if len(res) == 0 or len(res) > 1:
        raise RuntimeError(f"compute_totaldv labert produced {len(res)} solutions")

    v1_sol, v2_sol = res[0]
    info[0] = [r1, v1, r2, v2, v1_sol, v2_sol]
    dv1 = np.linalg.norm(v1 - v1_sol)
    dv2 = np.linalg.norm(v2 - v2_sol)
    return  (dv1 + dv2).value


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
        text = ""
        for body in self.bodies:
            text += body.getHUDInfo()
        return text

# class BodyOrbit:
#     def __init__(self, body, r0, v0, render=None, attractor=Earth, time=0*u.s,segments=0, width=2,  color=LVecBase4f(1,1,1,1)):
#         self.body = body
#         self.color = color
#         self.render = render
#         self.np = None
#         self.prev_np = None
#         self.manuever_np = None
#         self.collision = False
#         self.collision_np = None
#         self.trajectory_state = []
#         self.set(attractor, r0,v0, time=time, segments=segments)

#     def set(self, attractor, r0,v0, time=0*u.s, segments=0):
#         self.attractor = attractor
#         self.r0 = r0
#         self.v0 = v0
#         self.startTime = time*1  #breaks the reference to the simulator time, which otherwise would causes the update to not move
#         h = np.cross(r0, v0)

#         if np.linalg.norm(h).value > EPSILON:
#             self.kepler = Orbit.from_vectors(attractor, r0, v0)
#             if self.kepler.r_a < 0 or self.kepler.r_p < 0:
#                 debug(f"invalid kepler orbit {self.kepler.r_a}, {self.kepler.r_p}")
#                 self.kepler = None
#         else:
#             self.kepler = None

#         if segments > 0:
#             t_end = time + 1*u.hour
#             #if valid kepler orbit, find kepler orbit period
#             if self.kepler is not None:
#                 t_end = time + self.kepler.period
#             self.generatePath(time, t_end, segments)

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
    # def __str__(self):
    #     return f"BodyOrbit r0:{self.r0} v0:{self.v0} startTime:{self.startTime}"

    # def generatePath(self, t_start, t_end, segments=50):
    #     pos = []
    #     self.collision = False

    #     times = np.linspace(t_start, t_end, segments)
    #     for t in times:
    #         try:
    #             r,v = cowell(
    #                 self.attractor.k, 
    #                 self.r0,
    #                 self.v0,
    #                 t)
    #             self.collision = self.checkCollision(r) is not None
    #             if self.collision:
    #                 break
    #             pos.append(r.value)
    #         except RuntimeError as e:
    #             debug(f"{e}  break ------------------------------------------------------------")
    #             break
        
    #     if self.np is not None:
    #         self.np.removeNode()
    #     if len(pos) == 0:
    #         return
    #     path = primatives.createLineList(pos, close=False, color=self.color)
    #     self.np = NodePath(path)
    #     self.np.reparentTo(self.render)

    # def randomize(self, dist, vel, time=0*u.s, segments=50):

    #     # random 3d unit vector
    #     theta = np.random.uniform(0,2*np.pi)
    #     phi = np.random.uniform(-np.pi/2,np.pi/2)
    #     r = spherical_to_cartesian(dist.to(u.km).value, theta, phi)

    #     theta = np.random.uniform(0,2*np.pi)
    #     phi = np.random.uniform(-np.pi/2,np.pi/2)
    #     v = spherical_to_cartesian(vel.to(u.km/u.s).value, theta, phi)
    #     r = r*u.km
    #     v = v*u.km/u.s

    #     self.set(Earth, r, v, time=time, segments=segments)

    #     if self.manuever_np is not None:
    #         self.manuever_np.removeNode()

    #     return r, v



    # def clearManeuverVisualizations(self):
    #     self.trajectory_state = []
    #     if self.prev_np is not None:
    #         if not self.prev_np.is_empty():
    #             self.prev_np.removeNode()
    #     if self.manuever_np is not None:
    #         if not self.manuever_np.is_empty():
    #             self.manuever_np.removeNode()
    #     if self.collision_np is not None:
    #         if not self.collision_np.is_empty():
    #             self.collision_np.removeNode()

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
#     def setCollisionPoint(self, position):
#         if self.collision_np is None or self.collision_np.is_empty():
#             self.collision_np = NodePath(primatives.createCube(0.002,color=LVecBase4f(1,0,0,1)))
#             self.collision_np.reparentTo(self.render)
#         self.collision_np.setPos(LVecBase3f(*position))

#     def checkCollision(self, r, r_prev=None):
#         if self.attractor.R.to(u.km).value + EPSILON > np.linalg.norm(r).to(u.km).value:
#             self.collision = True
#             if r_prev is None:
#                 self.setCollisionPoint(r.to(u.km).value)
#                 return None
#             else:
#                 intersections = line_sphere_intersection(r_prev.to(u.km).value, 
#                                                         r.to(u.km).value, 
#                                                         [0,0,0], # replace with attractor position 
#                                                         self.attractor.R.to(u.km).value)
#                 if len(intersections) == 0:
#                     return None
#                 self.setCollisionPoint(intersections[0][1])
#             return intersections[0]
#         return None

#     # given lambert solution, create a psuedo manuever trajectory
#     def computePseudoManouverTrajectory(self, r1, v1, r2, v2, v1_sol, v2_sol, t_flight, color, t_start, thickness=5, t_launch=0*u.s, segments=100):
#         dv1 = v1_sol - v1
#         dv2 = v2_sol - v2
#         accel_max = self.body.thrust_max/self.body.mass
#         t_burn1 = (np.linalg.norm(dv1)/accel_max).to(u.s)
#         t_burn2 = (np.linalg.norm(dv2)/accel_max).to(u.s)

#         # bezier style spline interpolation of orbit propogations 
#         self.collision = False
#         self.trajectory_state = []
#         t_duration = t_burn1/2+ t_flight + t_burn2/2
#         self.trajectory_params = [r1, v1, r2, v2, v1_sol, v2_sol, t_flight, t_start*1, t_burn1, t_burn2, t_launch]
#         self.orbit_initial = BodyOrbit(self.body, r1, v1,self.render,self.attractor)
#         self.orbit_transfer = BodyOrbit(self.body, r1, v1_sol, self.render,self.attractor) 
#         self.orbit_final = BodyOrbit(self.body, r2, v2,self.render,self.attractor)

#         # use propagate function        
#         self.trajectory_state = []
#         pos = []

#         times = np.linspace(t_start-t_launch, t_start + t_duration, segments)
#         for t in times:
#             r,v = self.propagateManeuverTrajectory(t)
#             if len(self.trajectory_state) > 0:
#                 t_prev, r_prev, v_prev = self.trajectory_state[-1]
#                 res = self.checkCollision(r, r_prev)
#                 # store interpolated position and velocity
#                 if res is not None:
#                     i, rc = res
#                     vc = v_prev*(1-i) + v*i
#                     tc = t_prev*(1-i) + t*i
#                     self.trajectory_state.append((tc, rc*u.km, vc))
#                     break
#             self.trajectory_state.append((t,r,v))

#         for t,r,v in self.trajectory_state:
#             pos.append(r.to(u.km).value)

#         path = primatives.createLineList(pos, False, color, thickness)
#         if self.manuever_np is not None:
#             self.manuever_np.removeNode()
#         self.manuever_np = NodePath(path)
#         self.manuever_np.reparentTo(self.render)

#         return self.trajectory_state[-1][1], self.trajectory_state[-1][2]
    
#     def propagateManeuverTrajectory(self, t):
#         r1, v1, r2, v2, v1_sol, v2_sol, t_flight, t_start, t_burn1, t_burn2, t_launch = self.trajectory_params
#         ts = t-t_start+t_launch
#         # dv1 = v1_sol - v1
#         # dv2 = v2_sol - v2
#         # accel_max = self.body.thrust_max/self.body.mass
#         # t_burn1 = (np.linalg.norm(dv1)/accel_max).to(u.s)
#         # t_burn2 = (np.linalg.norm(dv2)/accel_max).to(u.s)

#         t_delay = 0*u.s
#         t_burn1_start = t_delay + t_launch
#         t_burn1_stop = t_burn1_start + t_burn1
#         t_burn2_start = t_burn1_start + t_flight + t_burn1/2 - t_burn2/2
#         t_burn2_stop = t_burn1_start + t_flight + t_burn1/2 + t_burn2/2
#         try:
#             if ts < t_burn1_start:
#                 #  (0,1)
#                 s = (ts-t_delay)/(t_launch)
#                 r = self.r_launch*(1-s*s) + r1*s*s  # simulate parabolic position
#                 v = self.v_launch*(1-s) + v1*s
#                 return r, v
#             elif ts < t_burn1_stop:  
#                 # (0,1)
#                 s = (ts-t_burn1_start)/(t_burn1_stop-t_burn1_start)
#                 ra,va = self.orbit_initial.propagate((s-1)*t_burn1/2)
#                 rb,vb = self.orbit_transfer.propagate(s*t_burn1/2)
#                 rc = ra*(1-s) + rb*s
#                 vc = va*(1-s) + vb*s
#                 return rc, vc
#             elif ts < t_burn2_start:
#                 #  (t_burn1/2, t_flight - t_burn2/2)
#                 s = ts-t_burn1/2
#                 return self.orbit_transfer.propagate(s)
#             elif ts < t_burn2_stop:
#                 # (0,1)
#                 s = (ts - t_burn2_start)/(t_burn2_stop-t_burn2_start)
#                 ra,va = self.orbit_transfer.propagate(t_flight + (s-1)*t_burn2/2)
#                 rb,vb = self.orbit_final.propagate(s*t_burn2/2)
#                 rc = ra*(1-s) + rb*s
#                 vc = va*(1-s) + vb*s
#                 return rc, vc
#             else:
#                 # t_burn2/2 ->
#                 s = ts-t_burn2_stop+t_burn2/2
#                 return self.orbit_final.propagate(s)
#         except u.core.UnitConversionError as e:
#             debug(f"{e} ------------------------------------------------------------")
#             s = (ts-t_burn1_start)/(t_burn1_stop-t_burn1_start)
#             ra,va = self.orbit_initial.propagate((s-1)*t_burn1/2)
#             rb,vb = self.orbit_transfer.propagate(s*t_burn1/2)
#             debug(f"t, ra,va: {s}, {ra}, {va}")
#             debug(f"t, rb,vb: {s}, {rb}, {vb}")

    

#     def setScale(self,cameraPos):
#         if self.collision_np is not None:
#             if not self.collision_np.is_empty():
#                 self.collision_np.setScale(np.linalg.norm(self.collision_np.getPos()-cameraPos.to(u.km).value))

#     #copy np to prev_np
#     def copyNP(self):
#         if self.np is not None:
#             if self.prev_np is not None:
#                 self.prev_np.removeNode()
#             self.prev_np = self.np.copyTo(self.render)
        
#     def propagate(self, t=0*u.s):
#         try:
#             if len(self.trajectory_state) > 0:
#                 return self.propagateManeuverTrajectory(t)
#             else:
#                 # only use kepler if we have a valid elliptical orbit
#                 if self.kepler is not None and (self.kepler.r_a.value > 0 and self.kepler.r_p.value > 0):
# #                    debug(f"kepler values {self.kepler.r_a.value}, {self.kepler.r_p.value}")
#                     return self.kepler.propagate(t-self.startTime).rv()
#                 else:
#                     # r,v = pa.twobody.propagation.cowell(
#                     # self.attractor.k.to(u.km**3 / u.s**2).value, 
#                     # self.r0.to(u.km).value,
#                     # self.v0.to(u.km/u.s).value, 
#                     # (t-self.startTime).to(u.s).value)
#                     # return r*u.km, v*u.km/u.s

#                     return cowell(
#                     self.attractor.k, 
#                     self.r0,
#                     self.v0, 
#                     (t-self.startTime))
#         except RuntimeError as e:
#             debug(f"{e} ------------------------------------------------------------")
#             debug(f"t, r0,v0: {t}, {self.r0.value}*u.km,  {self.v0.value}*u.km/u.s")
        
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
                 t0=T_ZERO, 
                 r1=R_ZERO, 
                 v1=V_ZERO, 
                 t1=T_INFINITY,
                 accel=V_ZERO/u.s,
                 type=Type.POSITION_LOCKED):
        self.set(body=body, 
                 attractor=attractor, 
                 r0=r0, 
                 v0=v0, 
                 rr0=rr0, 
                 rv0=rv0, 
                 t0=t0, 
                 r1=r1, 
                 v1=v1, 
                 t1=t1,
                 accel=accel,
                 type=type)

    def set(self, 
                 body=None, 
                 attractor=None, 
                 r0=R_ZERO, 
                 v0=V_ZERO, 
                 rr0=ROT_R_ZERO,
                 rv0=ROT_V_ZERO,
                 t0=T_ZERO, 
                 r1=R_ZERO, 
                 v1=V_ZERO, 
                 t1=T_INFINITY,
                 accel=V_ZERO/u.s,
                 type=Type.POSITION_LOCKED):
        self.type = type
        self.body = body
        self.attractor = attractor

        # entry state
        self.r0 = r0
        self.v0 = v0
        self.t0 = t0*1 #break reference
        self.rr0=rr0
        self.rv0=rv0

        # exit state
        self.r1 = r1
        self.v1 = v1
        self.t1 = t1*1 # break reference
        self.rr1=rr0
        self.rv1=rv0

        self.accel = accel

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
        if np.linalg.norm(self.accel).value < EPSILON and np.linalg.norm(np.cross(self.r0, self.v0).value) > EPSILON:
            kepler = Orbit.from_vectors(Earth, self.r0, self.v0)
            if kepler.r_a > 0 and kepler.r_p > 0:
                self.kepler = kepler

        self.computePeriodOrDuration()

    # fixed acceleration
    def ad(self, t0, u_, k):
        return self.accel.value

    # interpolate prograde to target acceleration
    # not working correctly - interpolation is not correct
    def ad_turn(self, t0, u_, k):
        i = t0/(self.t1-self.t0).value
        mag = np.linalg.norm(self.accel).value
        prograde = self.v0.value
        mag_norm = np.linalg.norm(prograde)
        if mag_norm < EPSILON:
            return [0,0,0]
        prograde *= mag/mag_norm
        return prograde*(1-i) + self.accel.value*i
    
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
            if a > 0*u.km and np.linalg.norm(self.accel).value < EPSILON:
                # Compute the period of the orbit
                self.period = 2 * np.pi * np.sqrt(a**3 / self.attractor.k)
        elif self.type == TrajectorySegment.Type.LAUNCH:
            # compute time to reach target altitude
            alt = np.linalg.norm(self.r0 - self.attractor.position)
            g = self.attractor.k/alt**2
            acc = self.body.thrust_max/self.body.mass - g
            self.period = np.sqrt(2*TRAJECTORY_LAUNCH_MIN_ALTITUDE/acc).to(u.s)

    def createGeometry(self, render=None, thickness=2, color=LVecBase4f(0,1,0,1)):                
        self.color = color
        self.thickness = thickness
        TRAJECTORY_SAMPLES = 100
        TRAJECTORY_NONPERIODIC_TIME_LIMIT = 4*u.hour
        if render is None:
            render = self.body.render

        if self.type == TrajectorySegment.Type.POSITION_LOCKED:
            return
        
        elif self.type == TrajectorySegment.Type.LANDED:
            steps = TRAJECTORY_SAMPLES
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
            steps = TRAJECTORY_SAMPLES
            times = np.linspace(self.t0, t_stop, steps)

        elif self.type == TrajectorySegment.Type.LAUNCH:
            t_stop = self.t1
            steps = TRAJECTORY_SAMPLES
            times = np.linspace(self.t0, t_stop, steps)

        positions = []
        t_last = self.t0
        v_last = self.v0
        r_last = self.r0
        for t in times:
            res = self.propagate(t)
            if res is None:
                debug(f"trajectory segment propagate failed: {t} -> {res}")
                break
            r,v,rot,w = res
            res = self.checkCollision(r, r_last, render)
            if res is not None:
                i, rc = res
                vc = v_last*(1-i) + v*i
                tc = t_last*(1-i) + t*i
                self.r1 = rc*u.km
                self.v1 = vc
                self.t1 = tc
                positions.append(rc)
                break
            
            positions.append(r.value)
            r_last = r
            v_last = v
            t_last = t


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

        if self.attractor.size.to(u.m) + 1*u.m > np.linalg.norm(r):
            self.collision = True
            if r_prev is None:
                self.setCollisionPoint(render, r.to(u.km).value)
                return None
            else:
                intersections = line_sphere_intersection(r_prev.to(u.km).value, 
                                                        r.to(u.km).value, 
                                                        self.attractor.position.to(u.km).value, 
                                                        self.attractor.size.to(u.km).value)
                if len(intersections) == 0:
                    debug(f"no intersection")
                    return None
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

    def propagate(self, t=0*u.s):

        if t < self.t0:
            return None
        if t > self.t1:
            return None
        
        if self.t0 == self.t1:
            return self.r0, self.v0, self.rr0, self.rv0

        ts = t.to(u.s)-self.t0

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
            return self.r0, self.v0, axis_quat.getHpr()*u.deg, w

        if self.type == TrajectorySegment.Type.LANDED:
            ts %= self.period
            rotation_quat.setFromAxisAngle((w[0]*ts).value, w[1])
            axis_quat *= rotation_quat
            #adjust position an velocity for rotation based on rotation of the parent
            pr, pv, p_rot, pw = self.body.parent.propagate(ts)
            
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
            return r, v, axis_quat.getHpr()*u.deg, p_quat

        if self.type == TrajectorySegment.Type.LAUNCH:
            # vec is normal to the planet
            vec = self.r0 - self.body.parent.position
            alt = np.linalg.norm(vec)
            vec = vec/alt
            g = self.body.parent.k/alt**2
            accel = self.body.thrust_max/self.body.mass - g.to(u.m/u.s/u.s)

            # this set absolute max accel
            if accel.value <= 0:
                accel = 0*u.m/u.s/u.s
                debug(f"net thurst accel {accel:.2f} not enough for lift off")

            # need to check this is above the planet's accel
            accel_vec = vec*accel
            v = self.v0 + accel_vec*ts
            r = self.r0 + self.v0*ts + 0.5*accel_vec*ts*ts
            return r, v, axis_quat.getHpr()*u.deg, w

        if self.type == TrajectorySegment.Type.BALLISTIC:
            self.kepler = None
            if self.kepler is not None:
                ts %= self.kepler.period
                try:
                    r,v = self.kepler.propagate(ts).rv()
                    return r, v, axis_quat.getHpr()*u.deg, w
                except RuntimeError as e:
                    debug(f"{e}  -----------------------------")
                    r,v = cowell(
                        self.attractor.k,
                        self.r0,
                        self.v0, 
                        ts, 
                        ad=self.ad)
                    return r, v, axis_quat.getHpr()*u.deg, w
            else:
                r,v = cowell(
                    self.attractor.k,
                    self.r0,
                    self.v0, 
                    ts, 
                    ad=self.ad)
                return r, v, axis_quat.getHpr()*u.deg, w
        debug("propagate un recognized segment type")
        return None

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
                 parent=None, 
                 mass = 1*u.kg,
                 lockedPosition=False,
                 fixedScale=False):
        self.name = name
        self.mass = mass
        # not sure why the u.kg is needed, none of the othe math is expecting it
        self.k = mass*(scipy.constants.G*u.m**3/u.kg/u.s**2).to(u.km**3/u.kg/u.s**2)
        self.lockedPosition = lockedPosition
        self.fixedScale = fixedScale
        self.type = type
        self.parent = parent
        # self.thrust_max = 0*u.kg*u.m/u.s/u.s
        # self.thrust = [0,0,0]*u.kg*u.m/u.s/u.s
        self.thrust_max = THRUST_MAX
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
            seg = TrajectorySegment(body=self,
                                    attractor=parent,
                                    r0=r0,
                                    v0=v0,
                                    rr0=rr0,
                                    rv0=rv0,
                                    t0=t_start,
                                    type=TrajectorySegment.Type.LANDED)
        else:
            seg = TrajectorySegment(body=self,
                                    attractor=parent,
                                    r0=r0,
                                    v0=v0,
                                    rr0=rr0,
                                    rv0=rv0,
                                    t0=t_start,
                                    type=TrajectorySegment.Type.BALLISTIC)
        self.trajectorySegments.append(seg)
 
    def setTarget(self, target):
        self.target = target

    def clearTrajectory(self):
        for seg in self.trajectorySegments:
            seg.np.removeNode()
        self.trajectorySegments = []

    def setScale(self,cameraPos):
        if self.np is None:
            return
        if self.fixedScale:
            return
        self.np.setScale(np.linalg.norm(self.position-cameraPos).to(u.km).value)

    def launch2(self, t_start, target):

        thickness = 2
        color = self.color

        self.target = target


        t_delay = 1*u.hour

        # compute landed delay trajectory
        r,v, rot, w = self.propagate(t_start+t_delay)
        self.trajectorySegments[-1].t1 = t_start+t_delay
        self.trajectorySegments[-1].r1 = r
        self.trajectorySegments[-1].v1 = v

        # compute thrust
        alt = np.linalg.norm(r-self.parent.position)
        g = self.parent.k/alt**2
        accel = self.thrust_max/self.mass - g.to(u.m/u.s/u.s)
        if accel.value <= 0:
            debug(f"Net thurst accel is {accel:.2f}.  Unable to overcome gravity for lift off")
            return

        #launch trajectory
        seg_launch = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r,
                                v0=v,
                                t0=t_start+t_delay,
                                type=TrajectorySegment.Type.LAUNCH)
        seg_launch.computePeriodOrDuration() 
        r1,v1, rot, w = seg_launch.propagate(seg_launch.t0 + seg_launch.period)
        seg_launch.r1 = r1
        seg_launch.v1 = v1
        seg_launch.t1 = seg_launch.t0 + seg_launch.period

        #fixed time guess compute transfer solution
        t_flight = 2*u.hour
        r2, v2, rot2, w2 = target.propagate(seg_launch.t1+t_flight)
        res = list(iod.izzo.lambert(Earth.k, r1, r2, t_flight, M=0))
        if len(res) == 0 or len(res) > 1:
            raise RuntimeError(f"compute_totaldv labert produced {len(res)} solutions")

        v1_sol, v2_sol = res[0]
        dv1 = np.linalg.norm(v1 - v1_sol)
        dv2 = np.linalg.norm(v2 - v2_sol)
        debug(f"dv1: {dv1:.2f} dv2: {dv2:.2f} energy: {dv1+dv2:.2f}")

        seg_transfer = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r1,
                                v0=v1_sol,
                                t0=seg_launch.t1,
                                t1=seg_launch.t1 + t_flight,
                                type=TrajectorySegment.Type.BALLISTIC)

        seg_target = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r2,
                                v0=v2,
                                t0=seg_transfer.t1,
                                type=TrajectorySegment.Type.BALLISTIC)

#        self.clearTrajectory()
        self.trajectorySegments.append(seg_launch)
        self.trajectorySegments.append(seg_transfer)
        self.trajectorySegments.append(seg_target)
        self.createTrajectoryGeometry(self.render, thickness, color)


    def launch(self, t_start):
        r,v, rot, w = self.propagate(t_start)
        thickness = 2
        color = self.color

        # compute thrust
        alt = np.linalg.norm(r-self.parent.position)
        g = self.parent.k/alt**2
        accel = self.thrust_max/self.mass - g.to(u.m/u.s/u.s)
        if accel.value <= 0:
            debug(f"Net thurst accel is {accel:.2f}.  Unable to overcome gravity for lift off")
            return

        #launch trajectory
        seg_launch = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r,
                                v0=v,
                                t0=t_start,
                                type=TrajectorySegment.Type.LAUNCH)
        self.trajectorySegments[-1].t1 = t_start*1
        self.trajectorySegments[-1].r1 = r
        self.trajectorySegments[-1].v1 = v

        seg_launch.computePeriodOrDuration() 
        r1,v1, rot, w = seg_launch.propagate(seg_launch.t0 + seg_launch.period)
        seg_launch.r1 = r1
        seg_launch.v1 = v1
        seg_launch.t1 = t_start + seg_launch.period

        # add orbit insertion trajectory
        # compute accel vector the is tangent to the planet surface along currnent velocity vector

        #tangent to planet
        perp_vec = np.cross(r1-self.parent.position, v1)
        vec_tangent = np.cross(perp_vec, r1-self.parent.position).value
        vec_tangent = vec_tangent/np.linalg.norm(vec_tangent)
        #prograde
        vec_prograde = v1/np.linalg.norm(v1) 

        #average
        accel_vec = 1.0*vec_tangent + 0.0*vec_prograde

        accel = (self.thrust_max/self.mass)*accel_vec/np.linalg.norm(accel_vec)
        accel = accel.to(u.km/u.s**2)
        t_burn = 13*u.min

        t_insertion_stop = seg_launch.t1 + t_burn
        seg_insertion = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r1,
                                v0=v1,
                                t0=seg_launch.t1,
                                t1=t_insertion_stop,
                                accel=accel,
                                type=TrajectorySegment.Type.BALLISTIC)
        
        r2, v2, rot, w = seg_insertion.propagate(t_insertion_stop)

        # add ballistic trajectory at the end of the luanch period
        seg_ballistic = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r2,
                                v0=v2,
                                t0=seg_insertion.t1,
                                type=TrajectorySegment.Type.BALLISTIC)

        # seg_ballistic = TrajectorySegment(body=self,
        #                         attractor=self.parent,
        #                         r0=r1,
        #                         v0=v1,
        #                         t0=seg_launch.t1,
        #                         type=TrajectorySegment.Type.BALLISTIC)


        self.clearTrajectory()
        self.trajectorySegments.append(seg_launch)
        self.trajectorySegments.append(seg_insertion)
        self.trajectorySegments.append(seg_ballistic)
        
        self.createTrajectoryGeometry(self.render, thickness, color)

    def propagate(self, t=0*u.s):

        if self.flag:
            debug("----------------------------------------------")
            for seg in self.trajectorySegments:
                debug(f"{self.name} t={t.value:.2e}  seg:{seg.t0.value:.2e} {seg.t1.value:.2e} {seg.type}")

        for seg in self.trajectorySegments:
            res = seg.propagate(t)
            if res is not None:
                self.lastSegment = seg
                return res
        # if self.lockedPosition:
        #     #get axis of rotation
        #     axis_quat = LQuaternion()
        #     axis_quat.setHpr(Vec3(*self.rr0.value))

        #     axis_vec = Vec3(0,0,1)
        #     axis_vec = axis_quat.xform(axis_vec)

        #     rotation_quat = LQuaternion()
        #     rotation_angle = self.rv0*t.to(u.s)
        #     rotation_quat.setFromAxisAngle(rotation_angle[0].value, axis_vec)
        #     axis_quat *= rotation_quat
        #     self.rotation = axis_quat.getHpr()*u.deg
        #     return self.position, self.velocity, rotation_quat

        # # if self.landed:
        # #     return self.position, self.velocity

        # # return self.orbit.propagate(t)
        # return self.position, self.velocity

    def update(self, time, dt):

        # if np.linalg.norm(self.thrust.value) >= epsilon:
        #     # if self.landed: # take off
        #     #     self.orbit.set(self.attractor,self.position, self.velocity, time, segments=0)
        #     pos, vel = self.orbit.propagate(time-dt)
        #     self.deltaV = self.thrust*dt/self.mass
        #     vel = vel + self.deltaV
        #     self.orbit.set(self.attractor,pos, vel, time)
        # else:

        res = self.propagate(time)        
        if res is None:
            return

        self.position, self.velocity, self.rotation, w = res
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
        # if self.lockedPosition:
        #     # only update rotation
        #     self.rotation = self.rotation + self.rotation_velocity*dt
        #     return

        # if not self.landed: # flying
        #     pos, vel = self.orbit.propagate(time)
        #     self.position = pos.to(u.km)
        #     self.velocity = vel.to(u.m/u.s)
        # elif not self.landedPrev:  # just landed
        #     pos, vel = self.orbit.propagate(time)
        #     #normlize pos to radius of attractor
        #     pos = self.attractor.R*pos/np.linalg.norm(pos)
        #     #velocity should match the surface rotation of attractor
        #     vel = [0,0,0]*u.m/u.s
        #     self.orbit.set(self.attractor,pos, vel, time, segments=0)
        #     self.position = pos.to(u.km)
        #     self.velocity = vel.to(u.m/u.s)

        # self.np.setPos(LVecBase3f(*self.position.value))
        # self.landedPrev = self.landed

        # #1 meter tolerance for landing
        # self.landed = self.attractor.R.to(u.m).value + 1 > np.linalg.norm(self.position.to(u.m).value)

    def getHUDInfo(self):
        if self.parent is None:
            alt = 0*u.km
        else:
            alt = np.linalg.norm(self.position - self.parent.position) - self.parent.size

        text = f"{self.name}"+\
            f"  Alt: {formatDistance(alt)}"+ \
            f"  Vel: {formatVelocity(np.linalg.norm(self.velocity))}\n"        
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

    def porkchop(self, t_start, target, resolution=5, show=False):

        p1 = self.trajectorySegments[0].period.to(u.s).value
        p2 = target.trajectorySegments[0].period.to(u.s).value

        period = np.max([p1,p2])
        # Generate some random data for the heat map
        guess = [t_start.to(u.s).value+period/2, period/2]
        radius = period/2

        # search for the starting point
        t_start = np.linspace(guess[0] - radius, guess[0] + radius, resolution)
        t_flight = np.linspace(guess[1] - radius*.9, guess[1] + radius*.9, resolution)
        data = np.zeros((len(t_flight), len(t_start)))
        info = [None]
        for i in range(len(t_start)):
            for j in range(len(t_flight)):
                data[i, j] = compute_dv([t_start[i], t_flight[j]], self, target, info)
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
        guess, min_value = self.porkchop(t_start, target)
        debug(f"porkchop guess: {guess} min_value: {min_value}")

        p1 = self.trajectorySegments[0].period.to(u.s).value
        p2 = target.trajectorySegments[0].period.to(u.s).value

        per = np.max([p1,p2])
        bounds = [(t_start.to(u.s).value, t_start.to(u.s).value + 2*per), (1,2*per)]
        info = [None]
        res = minimize(compute_dv, guess, args=(self, target, info), bounds=bounds)
        debug(f"minimize guess: {res.x} min_value: {res.fun}")

        t_delay = res.x[0]*u.s
        t_flight = res.x[1]*u.s
        r1, v1, r2, v2, v1_sol, v2_sol = info[0]

        seg = self.trajectorySegments[0]
        seg.t1 = t_delay
        seg.r1 = r1
        seg.v1 = v1

        seg_transfer = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r1,
                                v0=v1_sol,
                                t0=seg.t1,
                                r1=r2,
                                v1= v2_sol,
                                t1=t_delay + t_flight,
                                type=TrajectorySegment.Type.BALLISTIC)
        

        seg_target = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r2,
                                v0=v2,
                                t0=seg_transfer.t1,
                                type=TrajectorySegment.Type.BALLISTIC)
 
        self.target = target

        self.trajectorySegments.append(seg_transfer)
        self.trajectorySegments.append(seg_target)
        self.createTrajectoryGeometry(self.render, thickness=2, color=self.color)


    def computeInterceptManeuverFromLaunch(self, t_start, orbit2):
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
    
    def randomize(self, dist, vel, time=0*u.s):
        self.clearTrajectory()
        seg = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=self.position,
                                v0=self.velocity,
                                t0=time,
                                type=TrajectorySegment.Type.BALLISTIC)
        seg.randomize(dist, vel, time=time)
        self.trajectorySegments.append(seg)
        self.createTrajectoryGeometry(self.render, thickness=2, color=self.color)

    def createTrajectoryGeometry(self, render, thickness=2, color=LVecBase4f(0,1,0,1)):
        collision = False
        for seg in self.trajectorySegments:
            collision = seg.createGeometry(render=render, thickness=thickness, color=color)

        #add final trajectory segment on planet surface
        if collision:
            self.addCollisionTrjaectory(render, thickness=thickness, color=color)

    def addCollisionTrjaectory(self, render, thickness=2, color=LVecBase4f(0,1,0,1)):
        seg = self.trajectorySegments[-1]
        seg_new = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=seg.r1,
                                v0=seg.v1,
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


        self.createTrajectoryGeometry(self.render, thickness=2, color=self.color)

        # earth = primatives.createIcosphere(oe.EARTH_RADIUS.value, 1, None)
        # earth_np = NodePath(earth)
        # earth_np.reparentTo(self.render)
        # earth_np.setRenderModeWireframe()

#        self.np.setPos(LVecBase3f(*pos.value))

        #     earth = primatives.createIcosphere(oe.EARTH_RADIUS.value, 5)
        #     earth_np = NodePath(earth)
        #     earth_np.reparentTo(self.render)
        #     earth_np.setRenderModeWireframe()

        # self.np = NodePath(primatives.createCube(size, color=self.color))
        # self.np.reparentTo(render)