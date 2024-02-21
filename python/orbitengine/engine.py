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
import numpy as np
import numpy as np

EARTH_RADIUS_KM = const.R_earth.to(u.km)
T_ZERO = 0*u.s
T_INFINITY = sys.float_info.max*u.s
R_ZERO = [0,0,0]*u.km
V_ZERO = [0,0,0]*u.km/u.s
ROT_R_ZERO = [0,0,0]*u.rad
ROT_V_ZERO = [0,0,0]*u.rad/u.s
TEMP_ZERO = 0*u.Kelvin
EPSILON = np.finfo(float).eps
PLANET_ICOSHPERE_LEVEL = 4
THRUST_MAX = 10.0*u.kg*u.m/u.s/u.s
MIMIMUM_MANEUVER_ALTITUDE = 20*u.km
TRAJECTORY_LAUNCH_MIN_ALTITUDE = EARTH_RADIUS_KM/10
ROCKET_DRY_MASS = 10*u.kg

REACTION_MASS = 300*u.kg
REACTION_MASS_FLOW_RATE = 0.8*u.kg/u.s
EARTH_G0 = (9.81*u.m/u.s**2).to(u.km/u.s**2)

LAUNCH_TURN_TIME = 3
INSERTION_BURN_TIME = 2.82


# need to account for solar loading and internal heat generation
TEMP_RADIANT_CONSTANT = 0.000001
TEMP_SPACE = 0*u.Kelvin 
TEMP_EARTH = 293.15*u.Kelvin 
TEMP_THRUST_DT = 1*u.Kelvin/u.s  # really a f(engine efficiency and ship mass)

class DotDict(dict):
    def __getattr__(self, attr):
        return self.get(attr)

    def __setattr__(self, key, value):
        self[key] = value

SPECIFIC_IMPULSE_TYPE = DotDict({
    "Solid": 300*u.s,
    "Liquid": 450*u.s,
    "NTR": 900*u.s,
    "Ion": 3000*u.s,
    "Nuclear": 10000*u.s,
    "Antimatter": 2500000*u.s # beam core
})


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

def cartesian_to_spherical(x, y, z):
    r = np.sqrt(x**2 + y**2 + z**2)
    theta = np.arccos(z / r)
    phi = np.arctan2(y, x)
    return r, theta, phi

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



def func_twobody(t0, u_, k, acc_func, r0,v0, acc_params):   
    """Differential equation for the initial value two body problem.

    This function follows Cowell's formulation from poliastro

    Parameters
    ----------
    t0 : float
        Time.
    u_ : ~numpy.ndarray
        Six component state vector [x, y, z, vx, vy, vz] (km, km/s).
        plus mass and temperature
    k : float
        Standard gravitational parameter.
    acc_func : function(t0, u, k)
         Non Keplerian acceleration (km/s2).
    control :
        parameters to control the acceleration such as thrust vector
    """
    ax, ay, az, dm, dT = acc_func(t0, u_, k, r0, v0, acc_params)

    x, y, z, vx, vy, vz, mass, temp = u_
    r3 = (x**2 + y**2 + z**2)**1.5

    # need to suppport this for elliptical orbits as well
#    dT += -TEMP_RADIANT_CONSTANT*(temp-TEMP_SPACE) #cooling to space temp

    du = np.array([
        vx,
        vy,
        vz,
        -k * x / r3 + ax,
        -k * y / r3 + ay,
        -k * z / r3 + az,
        dm,
        dT
    ])

    return du

def cowell(k, r0, v0, m0, T0, t,  rtol=1e-10, *, acc_func=None, acc_params=None, callback=None, nsteps=1000):
    x, y, z = r0.to(u.km).value
    vx, vy, vz = v0.to(u.km/u.s).value
    m = m0.to(u.kg).value
    T = T0.to(u.Kelvin).value
    u0 = np.array([x, y, z, vx, vy, vz, m, T])

    # Set the non Keplerian acceleration to zero by default
    if acc_func is None:
        acc_func = lambda t0, u_, k_, r0, v0, params: (0, 0, 0, 0, 0)

    # Create an ode object
    rtol=1e-10
    nsteps=1000
    solver = ode(func_twobody).set_integrator('lsoda', method='bdf',rtol=rtol, nsteps=nsteps)  # Use VODE with BDF method
    solver.set_initial_value(u0)  # Set initial value at t=0
    solver.set_f_params(k.to(u.km**3/u.s**2).value, acc_func, r0, v0, acc_params)  # Pass parameter k to the ODE function

    # Integrate the ODE at specific time points
    sol1 = solver.integrate(t.to(u.s).value)

    return sol1[0:3]*u.km, sol1[3:6]*u.km/u.s, sol1[6]*u.kg, sol1[7]*u.Kelvin

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


def net_liftoff_accleration(isp, mass, flow_rate):
    thrust = EARTH_G0 * isp * flow_rate
#    mass = 100*u.kg
    accel = thrust/mass
    return accel - EARTH_G0


def plot_rocket_lift():
    steps = 100
    mass = np.linspace(100000*u.kg, 600000*u.kg, steps)
    flow_rate = np.linspace(0, 2000*u.kg/u.s, steps)

    isp = SPECIFIC_IMPULSE_TYPE.Solid

    # Compute net acceleration for each pair of mass and flow rate
    net_acceleration = net_liftoff_accleration(isp, mass[:, np.newaxis], flow_rate[np.newaxis, :])

    net_acceleration = net_acceleration.to(u.m/u.s**2).value
    mass = mass.to(u.kg).value
    flow_rate = flow_rate.to(u.kg/u.s).value

    levels = np.linspace(-10, 0, 10)
    plt.contour(flow_rate, mass, net_acceleration, colors='k',levels=levels)
    plt.imshow(net_acceleration, cmap='jet', origin='lower', extent=[flow_rate[0], flow_rate[-1],mass[0], mass[-1]])

    plt.axis('auto')    
    plt.ylabel('Mass (kg)')
    plt.xlabel('Mass Flow Rate (kg/s)')
    plt.title(f'Net Accel with Isp:{isp:.1f} @ {EARTH_G0.to(u.m/u.s**2):.02f}')
    plt.colorbar(label='Net Acceleration')
    plt.grid(True)
    plt.show()

def eccentricity(v, r, k):
    e = ((v.dot(v) - k / (np.linalg.norm(r))) * r - r.dot(v) * v) / k
    ecc = np.linalg.norm(e)
    return ecc


class AccParams:
    thrust_vec = np.array([0,0,0])
    reaction_isp = SPECIFIC_IMPULSE_TYPE.Liquid.value
    reaction_flow_rate = REACTION_MASS_FLOW_RATE.value
    mass_dry = ROCKET_DRY_MASS.value
    reaction_dT = TEMP_THRUST_DT.value


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
