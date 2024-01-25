import numpy as np
from scipy.optimize import minimize
import poliastro
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
from poliastro import iod
from astropy import units as u
import time

# don't optimize the starting time, just the time of flight
def compute_totaldv(x, orbit_target, time_weight, r1, v1, info):
    t_flight = x[0]*u.s
    r2, v2 = orbit_target.propagate(t_flight).rv()

    res = list(poliastro.iod.izzo.lambert(Earth.k, r1, r2, t_flight, M=0))
    if len(res) == 0 or len(res) > 1:
        raise RuntimeError(f"compute_totaldv labert produced {len(res)} solutions")

    v1_sol, v2_sol = res[0]
    info[0] = [v1, v2, v1_sol, v2_sol]
    total_dv = np.linalg.norm(v1 - v1_sol) + np.linalg.norm(v2 - v2_sol)
    return total_dv.value + time_weight*t_flight.value

orbit1 = Orbit.from_vectors(Earth, [2*Earth.R.to(u.km).value, 0,0]*u.km,     [0, 6, 0]*u.km/u.s)
orbit2 = Orbit.from_vectors(Earth, [1.5*Earth.R.to(u.km).value, 0,0]*u.km,   [0, 9, 0]*u.km/u.s)

t_start = 0*u.s # don't optimize this for now, slows double the compute time
t_flight = 1*u.s
t_weight = 1e-6  # let user adjust this?

# # Initial guess for the parameters
#x0 = np.array([t_start.value, t_flight.value])
x0 = np.array([t_flight.value])
r1, v1 = orbit1.propagate(t_start).rv()
# Define the bounds for the parameters
bounds = [(1, None)]
ts_start = time.time()
info = [None]
result = minimize(compute_totaldv, x0, args=(orbit2, t_weight, r1, v1, info), bounds=bounds)
ts_stop = time.time()
info = info[0]
t_flight = result.x[0]*u.s
print("iters:", result.nit)
print(f"t_period: {orbit1.period.to(u.hour):.2f}")
print(f"t_flight: {t_flight.to(u.hour):.2f}")
print("vel:", info)
print(f"dv:{np.linalg.norm(info[0]-info[2]):.2f} {np.linalg.norm(info[1]-info[3]):.2f}")
print(f"total_cost: {result.fun:.2f}")
print(f"Compute Time elapsed: {ts_stop-ts_start:.2f}")