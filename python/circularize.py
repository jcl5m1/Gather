import numpy as np
import orbitengine.engine as oe
import astropy.units as u
import scipy.constants
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
from scipy.optimize import minimize


def eccentricity(v, r, k):
    e = ((v.dot(v) - k / (np.linalg.norm(r))) * r - r.dot(v) * v) / k
    ecc = np.linalg.norm(e)
    return ecc

def circularize_maneuver(r0,v0, attractor_k):
    # compute the circular velocity at the desired altitude
    r = np.linalg.norm(r0).value
    v = np.linalg.norm(v0).value  
    return (0.5*v**2 - r)/attractor_k.value


r0 = np.array([6442.10116578,   86.01334177,   37.29261384] )*u.km
v0 = np.array([1.00248566, 0.43470921, 0.18847591])*u.km/u.s
k = Earth.k.to(u.km**3/u.s**2)

#instantaneous circularization
result = minimize(eccentricity, v0.value, args=(r0.value, k.value))

# circulatize burn with max thrust...take into account dm/dt


print(result.x)

orbit = Orbit.from_vectors(Earth, r0, result.x*u.km/u.s)
print(orbit)
print(orbit.ecc)