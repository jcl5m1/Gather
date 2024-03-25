from astropy import units as u
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
import numpy as np
from astropy import constants as const
from poliastro import iod
from scipy.optimize import fsolve
from scipy.spatial.transform import Rotation
from panda3d.core import LVecBase4f, NodePath, LVecBase3f,GeomVertexReader, GeomVertexWriter, GeomVertexData, GeomTriangles, GeomNode, LQuaternion, Vec3
from enum import Enum
import math
from scipy.optimize import minimize
import scipy.constants
import torch
import torchdiffeq as diffeq

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
from scipy.integrate import odeint, ode
import numpy as np
from scipy.special import expit
import pprint as ppt
import pickle
import hashlib

EARTH_RADIUS_KM = const.R_earth.to(u.km)
T_ZERO = 0*u.s
T_INFINITY = sys.float_info.max*u.s
R_ZERO = [0,0,0]*u.km
V_ZERO = [0,0,0]*u.km/u.s
ROT_R_ZERO = [0,0,0]*u.rad
ROT_V_ZERO = [0,0,0]*u.rad/u.s
ZERO_ANGLE_VECTOR = np.array([1,0,0])
TEMP_ZERO = 0*u.Kelvin
EPSILON = np.finfo(float).eps
PLANET_ICOSHPERE_LEVEL = 4

FALCON9_DRY_MASS = 5000*u.kg
FALCON9_REACTION_MASS = 95000*u.kg
FALCON9_REACTION_MASS_FLOW_RATE = 2000*u.kg/u.s
FALCON9_REACTION_EFFICIENCY = 0.98
FALCON9_RADIUS = (1.85*u.m).to(u.km)
FALCON9_LENGTH = (70*u.m).to(u.km)
FALCON9_AXIAL_CROSS_SECTION_AREA = np.pi*(FALCON9_RADIUS**2)
FALCON9_LATERAL_CROSS_SECTION_AREA = 2*FALCON9_RADIUS*FALCON9_LENGTH

# cylinder approximation
FALCON9_SURFACE_AREA = np.pi*(FALCON9_RADIUS*2*FALCON9_LENGTH) + 2 * FALCON9_AXIAL_CROSS_SECTION_AREA
FALCON9_SPECIFIC_HEAT = (1000*u.J/u.kg/u.Kelvin).to(u.N*u.km/u.kg/u.Kelvin)  # approx solid aluminum
FALCON9_EMISSIVITY = 0.4
FALCON9_AXIAL_DRAG_COEF = 0.3
FALCON9_LATERAL_DRAG_COEF = 2.5

EARTH_G0 = (9.81*u.m/u.s**2).to(u.km/u.s**2)
ALTITUDE_LEO = 500*u.km + EARTH_RADIUS_KM
ALTITUDE_GEO = 35786*u.km + EARTH_RADIUS_KM
ALTITUDE_LUNAR = 405953.805*u.km + EARTH_RADIUS_KM
EARTH_K = Earth.k.to(u.km**3/u.s**2)
EARTH_AXIS_ANGLE = [0,0,2*np.pi/(24*3600)]*u.rad/u.s  # need to correct for earth tilt
EARTH_ATMOSPHERE_RHO0 = (1.225*u.kg/u.m**3).to(u.kg/u.km**3)
EARTH_ATMOSPHERE_SCALE_HEIGHT = 8.5*u.km
MIMIMUM_MANEUVER_ALTITUDE = 20*u.km
TRAJECTORY_LAUNCH_MIN_ALTITUDE = EARTH_RADIUS_KM/10
LAUNCH_TURN_TIME = 3
INSERTION_BURN_TIME = 2.82


# need to account for solar loading and internal heat generation
STEFAN_BOLTZMANN_COEF = 5.67e-8
TEMP_SPACE = 0*u.Kelvin 
TEMP_EARTH = 293.15*u.Kelvin

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

import inspect
import builtins

# requires object to have input_dict() method
def obj_input_hash(obj):
    curr_precision = np.get_printoptions()['precision']
    np.set_printoptions(precision=2)
    hash = hashlib.md5(str(obj.input_dict()).encode()).hexdigest()
    np.set_printoptions(precision=curr_precision)
    return hash

def obj_input_hash_filename(obj, dir=''):
    filename = f"{obj.__class__.__name__}_{obj_input_hash(obj)}.pkl"
    return os.path.join(dir,filename)

# requires object to have input_dict() method
def obj_cache_load(obj, dir='cache'):
    filename = obj_input_hash_filename(obj,dir)
    if os.path.exists(filename):
        with open(filename, 'rb') as f:
            obj2 = pickle.load(f)
            obj.__dict__ = obj2.__dict__
            print(f"Loaded from {filename}")
            return True
    return False

def obj_cache_save(obj, dir='cache'):
    filename = obj_input_hash_filename(obj,dir)
    dir_name = os.path.dirname(filename)
    os.makedirs(dir_name, exist_ok=True)
    with open(filename, 'wb') as f:
        print(f"Saved to {filename}")
        pickle.dump(obj, f)

def print(*args, **kwargs):
    # Get the previous frame in the stack, otherwise it would be this function
    frame = inspect.currentframe().f_back
    # Get the file name and line number of the previous frame
    file_name = os.path.basename(frame.f_code.co_filename)
    line_number = frame.f_lineno
    # Call the original print function with the file name and line number
    builtins.print(f"{file_name}:{line_number} ", *args, **kwargs)

def pprint(*args, **kwargs):
    # Get the previous frame in the stack, otherwise it would be this function
    frame = inspect.currentframe().f_back
    # Get the file name and line number of the previous frame
    file_name = os.path.basename(frame.f_code.co_filename)
    line_number = frame.f_lineno
    # Call the original print function with the file name and line number
    builtins.print(f"{file_name}:{line_number}:")
    ppt.pprint(*args, **kwargs)

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


# reverse first two paramters for odeint, wrapping function threw error?
def twobody_ode(u, t, k, acc_params):
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
    acc_params : 
        parameters to control the acceleration
    """

    ax, ay, az, dm, dT = acc_params.func(t, u, k)
    
    x, y, z, vx, vy, vz, mass, temp = u
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

def twobody(t, u_, k, acc_params):   
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
    ax, ay, az, dm, dT = acc_params.func(t, u_, k)

    x, y, z, vx, vy, vz, mass, temp = u_
    r3 = (x**2 + y**2 + z**2)**1.5

    # need to suppport this for elliptical orbits as well
#    dT += -TEMP_RADIANT_CONSTANT*(temp-TEMP_SPACE) #cooling to space temp

    du = torch.tensor([
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


def cowell(k, r0, v0, m0, T0, t,  rtol=1e-10, *, acc_params=None, callback=None, nsteps=1000, use_torchdiffeq=False):
    x, y, z = r0.to(u.km).value
    vx, vy, vz = v0.to(u.km/u.s).value
    m = m0.to(u.kg).value
    T = T0.to(u.Kelvin).value
    u0 = np.array([x, y, z, vx, vy, vz, m, T])

    if acc_params is not None:
        # no reaction mass, skip the thrust calculation
        if acc_params.mass_dry >= m:
            acc_params = None

    # Set the non Keplerian acceleration to zero by default
    if acc_params is None:
        acc_params = AccParams()
    
    # Create an ode object
    if use_torchdiffeq:
        # Solve the ODE
        print("Using torchdiffeq - UNTESTED")
        if len(t.shape) == 0:
            solution = diffeq.odeint(lambda y,t: twobody(y,t, k.to(u.km**3/u.s**2).value, acc_params), u0, [0,t], method='dopri5')
        else:
            solution = diffeq.odeint(lambda y,t: twobody(y,t, k.to(u.km**3/u.s**2).value, acc_params), u0, t, method='dopri5')
    else:
        if len(t.shape) == 0:
            # rtol=1e-8
            # nsteps=1000
            # solver = ode(twobody).set_integrator('lsoda', method='bdf',rtol=rtol, nsteps=nsteps)  # Use VODE with BDF method
            # solver.set_initial_value(u0)  # Set initial value at t=0
            # solver.set_f_params(k.to(u.km**3/u.s**2).value, acc_params)  # Pass parameter k to the ODE function
            # sol = solver.integrate(t.to(u.s).value)
            # return sol[0:3]*u.km, sol[3:6]*u.km/u.s, sol[6]*u.kg, sol[7]*u.Kelvin

            solution = odeint(twobody_ode, u0, [0,t.value], args=(k.to(u.km**3/u.s**2).value, acc_params))
            sol = solution[-1]
            return sol[0:3]*u.km, sol[3:6]*u.km/u.s, sol[6]*u.kg, sol[7]*u.Kelvin
        else:
            solution = odeint(twobody_ode, u0, t.value, args=(k.to(u.km**3/u.s**2).value, acc_params))
    return solution[:, 0:3]*u.km, solution[:, 3:6]*u.km/u.s, solution[:, 6]*u.kg, solution[:, 7]*u.Kelvin


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
    def __init__(self, 
                 thrust_vec=None, 
                 reaction_isp=SPECIFIC_IMPULSE_TYPE.Liquid,
                 reaction_flow_rate=FALCON9_REACTION_MASS_FLOW_RATE,
                 mass_dry=FALCON9_DRY_MASS,
                 reaction_efficiency=FALCON9_REACTION_EFFICIENCY,
                 surface_area=FALCON9_SURFACE_AREA,
                 axial_cross_section=FALCON9_AXIAL_CROSS_SECTION_AREA,
                 lateral_cross_section=FALCON9_LATERAL_CROSS_SECTION_AREA,
                 emissivity=FALCON9_EMISSIVITY,
                 specific_heat=FALCON9_SPECIFIC_HEAT,
                 ambient_temperature=TEMP_SPACE,
                 atmosphere_axial_drag_coefficient=FALCON9_AXIAL_DRAG_COEF,
                 atmosphere_lateral_drag_coefficient=FALCON9_LATERAL_DRAG_COEF,
                 atmosphere_rho0=EARTH_ATMOSPHERE_RHO0,
                 atmosphere_scale_height=EARTH_ATMOSPHERE_SCALE_HEIGHT
                 ):
        if thrust_vec is None:
            self.func = self.ballistic 
        else:
            self.func = self.thrust_vectored
            self.thrust_vec = thrust_vec.value

        # thurst and reaction mass
        self.reaction_isp = reaction_isp.value
        self.reaction_flow_rate = reaction_flow_rate.value
        self.mass_dry = mass_dry.value
        self.reaction_efficiency = reaction_efficiency

        # temperature and cooling
        self.surface_area = surface_area.value
        self.emissivity = emissivity # units?
        self.specific_heat = specific_heat.value
        self.ambient_temperature = ambient_temperature.value

        # air drag calculations
        self.atmosphere_axial_drag_coefficient = atmosphere_axial_drag_coefficient
        self.atmosphere_lateral_drag_coefficient = atmosphere_lateral_drag_coefficient
        self.atmosphere_rho0 = atmosphere_rho0.value
        self.atmosphere_scale_height = atmosphere_scale_height.value
        self.axial_cross_section = axial_cross_section.value
        self.lateral_cross_section = lateral_cross_section.value
        self.lateral = False

    def ballistic(self, t, u_, k):
#        return (0,0,0,0,0)
        dT = self.dT_radiation(u_)
        drag_force, dT_drag = self.atmospheric_drag(u_)
#        print(dT_drag)
        mass = u_[6]
        dv = drag_force/mass
        dm = 0
        return (dv[0], dv[1], dv[2], dm, dT+dT_drag)

    def dT_radiation(self, u_):
        C = self.specific_heat
        A = self.surface_area
        m = u_[6]  # mass
        T = u_[7]  # temperature
        Ta = self.ambient_temperature

        # Radiant temperature change
        dT = -self.emissivity * STEFAN_BOLTZMANN_COEF * A * (T**4 - Ta**4) / (m * C)

        return dT

    # thrust vectored acceleration function
    def thrust_vectored(self, t, u_, k):
        mass = u_[6] 
        thrust_vec = self.thrust_vec

        dm = self.reaction_flow_rate
        isp = self.reaction_isp

        dT = self.dT_radiation(u_)
        drag_force, dT_drag = self.atmospheric_drag(u_)
        dT += dT_drag

        # ode solver doesn't like if statement
        # differentiable sigmoid function that stops thrust when fuel is gone
#        dm *= expit(10*(mass-self.mass_dry))  
        if mass < self.mass_dry:
            dv = drag_force/mass
            return (dv[0], dv[1], dv[2], 0, dT)
        
        exhaust_velocity = EARTH_G0.value * isp 
        thrust = exhaust_velocity * dm

        # waste heat from engine
        ideal_exhaust_power = 0.5 * dm * exhaust_velocity**2
        waste_heat_power = ideal_exhaust_power*(1-self.reaction_efficiency)
        dT_engine = waste_heat_power / (self.specific_heat * mass)
        dT += dT_engine

        dv = (self.reaction_efficiency*thrust_vec*thrust + drag_force)/mass

        return (dv[0],dv[1],dv[2], -dm, dT)

    # thrust vectored acceleration function
    def atmospheric_drag(self, u_):
        r, v = u_[0:3], u_[3:6]
        mass = u_[6]
        # could move this altitude check outside to speed it up
        altitude = np.linalg.norm(r)-EARTH_RADIUS_KM.value
        if altitude > 10*self.atmosphere_scale_height: # don't compute drag in space
            return np.array([0,0,0]), 0
        v_mag = np.linalg.norm(v)

        drag_coef = self.atmosphere_lateral_drag_coefficient if self.lateral else self.atmosphere_axial_drag_coefficient
        cross_section = self.lateral_cross_section if self.lateral else self.axial_cross_section
        rho = self.atmosphere_rho0 * np.exp(-altitude/self.atmosphere_scale_height)
        drag_force = -0.5 * rho * v_mag**2 * cross_section * drag_coef * (v / v_mag)
        dT_drag = np.linalg.norm(drag_force)*v_mag/(self.specific_heat*mass)
        return drag_force, dT_drag


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
