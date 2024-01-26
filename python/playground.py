import numpy as np
from scipy.optimize import minimize
import poliastro
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
from poliastro import iod
from astropy import units as u
import time
import orbitengine as oe
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



t=39293.926580610416*u.s
r=[-1280.4955394990714,1035.0559881618285,-4366.016000409225]*u.km
v=[0.8989460062372656,0.8387594839256237,12.356052042098284]*u.km/u.s
# r = [ 10000,0,0]*u.km
# v = [ 1,0,0]*u.km/u.s

orbit = oe.BodyOrbit(None, r, v)
print(orbit)
print(orbit.propagate(t))