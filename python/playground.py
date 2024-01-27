import numpy as np
from poliastro.bodies import Earth
from astropy import units as u
import poliastro as pa
import orbitengine as oe

np.set_printoptions(precision=3)

import numpy as np
from scipy.integrate import ode

def func_twobody(t0, u_, k, ad):
    """Differential equation for the initial value two body problem.

    This function follows Cowell's formulation.

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

r0 = [ 10000,0,0]*u.km
v0 = [ 1,0,0]*u.km/u.s
k = Earth.k

times = np.linspace(0, 5000, 100)
xs = []
for t in times:
    r,v = cowell(k, r0, v0, t*u.s)
    xs.append(r[0].value)

import matplotlib.pyplot as plt
plt.plot(times, xs)
plt.show()