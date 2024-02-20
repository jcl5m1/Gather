import numpy as np
import orbitengine.engine as oe
import astropy.units as u
import scipy.constants
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
from scipy.optimize import minimize
import orbitengine.trajectorysegment as ts
import time
from scipy.spatial.transform import Rotation as R

def eccentricity(v, r, k):
    e = ((v.dot(v) - k / (np.linalg.norm(r))) * r - r.dot(v) * v) / k
    ecc = np.linalg.norm(e)
    return ecc

class Control:
    thrust_vec = np.array([0,0,0])
    theta = 0*u.deg
    phi = 0*u.deg

class State:
    def __init__(self, timestamp=0*u.s, r=oe.R_ZERO, v=oe.V_ZERO, m=0*u.kg, T=0*u.Kelvin):
        # expected units: t[s], r[km], v[km/s], m[kg], temp[K]
        self.timestamp = timestamp.to(u.s)
        self.position = r.to(u.km)
        self.velocity = v.to(u.km/u.s)
        self.mass = m.to(u.kg)
        self.tempurature = T.to(u.Kelvin)

    def ecc(self, k):
        return eccentricity(self.velocity.value, self.position.value, k.value)
    
    def to_list(self):
        return [self.position, self.velocity, self.mass, self.tempurature]
    
    def prograde_vector(self):
        return self.velocity / np.linalg.norm(self.velocity)
        
    def normal_vector(self):
        angular_momentum = np.cross(self.position, self.prograde_vector())
        return angular_momentum / np.linalg.norm(angular_momentum)
    
    def attractor_vector(self):
        return self.position / np.linalg.norm(self.position)
        
    def tangent_vector(self):
        return np.cross(self.normal_vector(), self.attractor_vector())
    
    def max_accel(self, isp=oe.SPECIFIC_IMPULSE_TYPE.Liquid, flow=oe.REACTION_MASS_FLOW_RATE):
        max_accel = (oe.EARTH_G0*isp*flow)/self.mass
        return max_accel

def post_planar_maneuver(angle, t, r0, v0, m0, T0, k):
    prograde_vec = v0 / np.linalg.norm(v0)

    h = np.cross(r0, prograde_vec) # orbit normal vector
    h = h / np.linalg.norm(h)

    #rotate the prograde vector by the angle about the orbit normal vector
    r = R.from_rotvec(angle*h)
    thrust_vec = r.apply(prograde_vec)

    control = Control()
    control.thrust_vec = thrust_vec

    return oe.cowell(
        k=k,
        r0=r0,
        v0=v0, 
        m0=m0,
        T0=T0,
        t=t*u.s,
        acc_func=ts.TrajectorySegment.acc_func_thrust_vectored,
        control=control)


def post_planar_maneuver_ecc(x, r0, v0, m0, T0, k):
    # thrust angle is deviation from prograde vector in the orbit normal plane
    angle, t = x
    r,v,_,_ = post_planar_maneuver(angle, t, r0, v0, m0,T0, k)
    ecc = eccentricity(v.value, r.value, k.value)
    return ecc

r0 = np.array([6442.10116578,   86.01334177,   37.29261384] )*u.km
v0 = np.array([1.00248566, 0.43470921, 0.18847591])*u.km/u.s
k = Earth.k.to(u.km**3/u.s**2)
m0 = 166*u.kg
T0 = oe.TEMP_EARTH

state0 = State(0*u.s, r0, v0, m0, T0)

#print("Pre Ecc:", eccentricity(v0.value, r0.value, k.value))
print("Pre Ecc:", state0.ecc(k))

# print("Guess Angle:",guess_angle)
prograde_vec = state0.prograde_vector()
tangent_vec = state0.tangent_vector()
guess_angle = np.arccos(np.dot(prograde_vec, tangent_vec))
print("Guess Angle:",guess_angle)

guess_velocity = np.sqrt(k/np.linalg.norm(r0)) #circular orbit velocity
guess_dv = guess_velocity*np.dot(tangent_vec,prograde_vec) # how much dv is still needed
max_accel = state0.max_accel()
guess_dt = guess_dv/max_accel


x0 = [guess_angle.value, guess_dt.value] # angle, time
ecc = post_planar_maneuver_ecc(x0, *state0.to_list(), k)
print(x0)
print("Guess Ecc:",ecc)
ts_start = time.time()
res = minimize(post_planar_maneuver_ecc, x0, args=(*state0.to_list(), k))
ts_end = time.time()
print("Time to optimize:",ts_end-ts_start)
print("Post Optimized Ecc: ",res.fun)

r,v,m,temp = post_planar_maneuver(*res.x, *state0.to_list(), k)
print("Post Optimized Vel: ",np.linalg.norm(v))
print("Post Optimized Alt: ",np.linalg.norm(r)-oe.EARTH_RADIUS)
print("Post Optimized Mass:",m)
print("Post Optimized Temp:",temp)