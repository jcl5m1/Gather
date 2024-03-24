import numpy as np
import matplotlib.pyplot as plt
from scipy.integrate import odeint
from scipy.integrate import solve_ivp
from scipy.optimize import minimize
import matplotlib.gridspec as gridspec
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
from astropy import units as u
import scipy
import orbitengine.engine as oe
from orbitengine.body import Body
from scipy.integrate import odeint, ode
import time

np.set_printoptions(precision=2)

# rocket on ground
r0 = np.array([oe.EARTH_RADIUS_KM.value, 0, 0])*u.km
ground_velocity = oe.EARTH_RADIUS_KM*2*np.pi/(24*3600*u.s)
v0 = np.array([0, ground_velocity.value, 0])*u.km/u.s
m0 = 100000*u.kg # rocket + fuel
#dry_mass =  oe.FALCON9_DRY_MASS
T0 = oe.TEMP_EARTH
#isp = oe.SPECIFIC_IMPULSE_TYPE.Liquid
state_launch = Body.State( r0, v0, m0, T0, parent_axis_angle=oe.EARTH_AXIS_ANGLE)

# compute a target in circular orbit
state_leo = Body.State(np.array([-oe.ALTITUDE_LEO.value, 0, 0])*u.km,
                       np.array([0, -5, 0])*u.km/u.s,   # guess
                        m0,
                        T0).circularized(oe.EARTH_K)
state_geo = Body.State(np.array([-oe.ALTITUDE_GEO.value, 0, 0])*u.km,
                       np.array([0, -5, 0])*u.km/u.s,   # guess
                        m0,
                        T0).circularized(oe.EARTH_K)

s = state_leo
t = 100
epsilon = 1e-6

ts = 100*np.random.rand(100)+1
ts = np.linspace(0.01, t, 100) 
#ts = 100*np.sin(np.linspace(0.01,np.pi, 100)) 
k = Earth.k.to(u.km**3/u.s**2)
acc_params = oe.AccParams()
acc_params.thrust_vec = np.array([1, 0., 0.])

u0 = [*s.position.value, *s.velocity.value, s.mass.value, s.temperature.value]
# print(u0)


# rtol=1e-5
# nsteps=500
# solver = ode(oe.twobody)#.set_integrator('lsoda', method='bdf',rtol=rtol, nsteps=nsteps)  # Use VODE with BDF method
# solver.set_initial_value(u0)  # Set initial value at t=0
# solver.set_f_params(k.to(u.km**3/u.s**2).value, acc_params)

# t = 10*u.s
# sol = solver.integrate(t.to(u.s).value)
# print(sol[:3])

# t = 50*u.s
# sol = solver.integrate(t.to(u.s).value)
# print(sol[:3])

# t = 100*u.s
# sol = solver.integrate(t.to(u.s).value)
# print(sol[:3])

# solution = odeint(oe.twobody_ode, u0, [0,t], args=(k.value, acc_params))
# position = solution[:, :3]
# altitude = np.linalg.norm(position, axis=1) - oe.EARTH_RADIUS_KM.value
# print(altitude)
# s2 =  s.propagate(k, t*u.s, acc_params)

# plt.plot(ts, altitude)
# plt.show()

start_time = time.time()
alt2 = []
for t in ts:
    s2 =  s.propagate(k, t*u.s, acc_params)
    alt2.append(np.linalg.norm(s2.position.value) - oe.EARTH_RADIUS_KM.value)

# states = s.propagate(k, ts*u.s, acc_params)
# alt2 = [np.linalg.norm(s.position.value) - oe.EARTH_RADIUS_KM.value for s in states]
stop_time = time.time()
print("Run Time: ", stop_time - start_time)
plt.plot(10*ts)
plt.plot(ts, alt2)
plt.show()