import orbitengine.engine as oe
from orbitengine.body import Body
import numpy as np
import astropy.units as u


r0 = np.array([2000+oe.EARTH_RADIUS_KM, 0, 0])*u.km
v0 = np.array([0, 9, 0])*u.km/u.s
m0 = 1000*u.kg
T0 = oe.TEMP_EARTH
state = Body.State(r0,v0, m0, T0).circularized(oe.EARTH_K)

print(state.ecc(oe.EARTH_K))