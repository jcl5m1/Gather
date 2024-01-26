import numpy as np
# from scipy.optimize import minimize
# import poliastro
from poliastro.bodies import Earth
# from poliastro.twobody import Orbit
# from poliastro import iod
from astropy import units as u
# import time
import orbitengine as oe
# import numpy as np

np.set_printoptions(precision=3)
# # don't optimize the starting time, just the time of flight
# def compute_totaldv(x, orbit_target, time_weight, r1, v1, info):
#     t_flight = x[0]*u.s
#     r2, v2 = orbit_target.propagate(t_flight).rv()

#     res = list(poliastro.iod.izzo.lambert(Earth.k, r1, r2, t_flight, M=0))
#     if len(res) == 0 or len(res) > 1:
#         raise RuntimeError(f"compute_totaldv labert produced {len(res)} solutions")

#     v1_sol, v2_sol = res[0]
#     info[0] = [v1, v2, v1_sol, v2_sol]
#     total_dv = np.linalg.norm(v1 - v1_sol) + np.linalg.norm(v2 - v2_sol)
#     return total_dv.value + time_weight*t_flight.value



# t=10*u.s
r = [ 10000,0,0]*u.km
v = [ 1,0,0]*u.km/u.s



import numpy as np
from scipy.integrate import ode



def func_twobody(t0, u_, k):
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
    x, y, z, vx, vy, vz = u_
    r3 = (x**2 + y**2 + z**2)**1.5

    du = np.array([
        vx,
        vy,
        vz,
        -k * x / r3,
        -k * y / r3,
        -k * z / r3
    ])

    print(f"{t0:.2f} {du}")
    return du


# # Define the ODE function
# def ode_func(t, y, k):
#     print(f"{t:.2f} {y} {k}")
#     return -k * y


x, y, z = r.value
vx, vy, vz = v.value
u0 = np.array([x, y, z, vx, vy, vz])
k = Earth.k.value
# Create an ode object
rtol=1e-4
nsteps=1000
r = ode(func_twobody).set_integrator('lsoda', method='bdf',rtol=rtol, nsteps=nsteps)  # Use VODE with BDF method
r.set_initial_value(u0)  # Set initial value at t=0
r.set_f_params(k)  # Pass parameter k to the ODE function

# Integrate the ODE at specific time points
t1 = 3000.0
sol1 = r.integrate(t1)
print(f"t={t1}: {sol1}")


orbit = oe.BodyOrbit(None, r, v)
print(orbit)

print(orbit.propagate(t*u.s))
