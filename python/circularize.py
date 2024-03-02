import numpy as np
import orbitengine.engine as oe
import astropy.units as u
import scipy.constants
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
from scipy.optimize import minimize
import orbitengine.trajectorysegment as ts
from orbitengine.body import Body
import time
from scipy.spatial.transform import Rotation as R
import matplotlib.pyplot as plt

def post_planar_maneuver(angle, t, r0, v0, m0, T0, k):
    prograde_vec = v0 / np.linalg.norm(v0)

    h = np.cross(r0, prograde_vec) # orbit normal vector
    h = h / np.linalg.norm(h)

    #rotate the prograde vector by the angle about the orbit normal vector
    r = R.from_rotvec(angle*h)
    thrust_vec = r.apply(prograde_vec)

    params = oe.AccParams()
    params.thrust_vec = thrust_vec

    return oe.cowell(
        k=k,
        r0=r0,
        v0=v0, 
        m0=m0,
        T0=T0,
        t=t*u.s,
        acc_params=params)

def post_planar_maneuver_ecc(x, r0, v0, m0, T0, k):
    # thrust angle is deviation from prograde vector in the orbit normal plane
    angle, t = x
    r,v,_,_ = post_planar_maneuver(angle, t, r0, v0, m0,T0, k)
    ecc = oe.eccentricity(v.value, r.value, k.value)
    return ecc


def post_launch_maneuver(t_launch, angle, t_circularize, r0, v0, m0, T0, k):

    normal_vec = r0/np.linalg.norm(r0)
    launch_params = oe.AccParams()
    launch_params.thrust_vec = normal_vec

    r1,v1,m1,T1 = oe.cowell(
        k=k,
        r0=r0,
        v0=v0, 
        m0=m0,
        T0=T0,
        t=t_launch*u.s,
        acc_params=launch_params)

    prograde_vec = v0 / np.linalg.norm(v0)
    h = np.cross(r0, prograde_vec) # orbit normal vector
    h = h / np.linalg.norm(h)

    #rotate the prograde vector by the angle about the orbit normal vector
    r = R.from_rotvec(angle*h)
    thrust_vec = r.apply(prograde_vec)

    circularize_params = oe.AccParams()
    circularize_params.thrust_vec = thrust_vec

    r2,v2,m2,T2= oe.cowell(
        k=k,
        r0=r1,
        v0=v1, 
        m0=m1,
        T0=T1,
        t=t_circularize*u.s,
        acc_params=circularize_params)
    
    return r2,v2,m2,T2


def post_launch_maneuver_score(x, r0, v0, m0, T0, k, target_alt):
    # thrust angle is deviation from prograde vector in the orbit normal plane
    t_launch, angle, t_insert = x
    r,v,_,_ = post_launch_maneuver(t_launch, angle, t_insert, r0, v0, m0, T0, k)
    altitude = np.linalg.norm(r)-oe.EARTH_RADIUS_KM
    alt_err = (altitude-target_alt).value
    ecc = oe.eccentricity(v.value, r.value, k.value)*100
#    print(ecc, altitude)
    return ecc*ecc + alt_err*alt_err


def post_launch_intercept_maneuver(launch_delay, 
                                   launch_burn_duration, 
                                   intercept_burn_theta,  
                                   intercept_burn_phi, 
                                   intercept_delay, 
                                   intercept_burn_duration, 
                                   state0,
                                   k):

    # propogate by delay time
    state1 = state0.cowell(k, launch_delay*u.s)

    # compute post launch burn, normal to surface at time of launch
    normal_vec = state1.position/np.linalg.norm(state1.position)
    launch_params = oe.AccParams(thrust_vec=normal_vec)

    state2 = state1.cowell(k, launch_burn_duration*u.s, acc_params=launch_params)
    
    #popagate by intercept delay
    state3 = state2.cowell(k, intercept_delay*u.s)

    # propogate by intercept burn     
    thrust_vec = oe.spherical_to_cartesian(1, intercept_burn_theta, intercept_burn_phi)
    intercept_params = oe.AccParams(thrust_vec=np.array(thrust_vec))

    state4 = state3.cowell(k, intercept_burn_duration*u.s, acc_params=intercept_params)
    
    return state4


def post_launch_intercept_score(x, state0, k, target_state0):
    # thrust angle is deviation from prograde vector in the orbit normal plane
    launch_delay, launch_burn_duration, intercept_burn_theta, intercept_burn_phi, intercept_delay, intercept_burn_duration = x
    t_total = launch_delay + launch_burn_duration + intercept_delay + intercept_burn_duration
    state_final = post_launch_intercept_maneuver(launch_delay, launch_burn_duration, intercept_burn_theta, intercept_burn_phi, intercept_delay, intercept_burn_duration, state0, k)

    # proprogate target by same time
    target_state_final = target_state0.cowell(k, t_total*u.s)

    # compute dr and dv to target
    dr = np.linalg.norm(target_state_final.position - state_final.position).value
    dv = np.linalg.norm(target_state_final.velocity - state_final.velocity).value
    return dr*dr + dv*dv


def post_launch_alt_score(x, state0, k, alt):
    # thrust angle is deviation from prograde vector in the orbit normal plane
    launch_burn_duration, intercept_burn_theta, intercept_burn_phi, intercept_delay, intercept_burn_duration = x
    launch_delay = 0
    t_total = launch_delay + launch_burn_duration + intercept_delay + intercept_burn_duration
    state_final = post_launch_intercept_maneuver(launch_delay, launch_burn_duration, intercept_burn_theta, intercept_burn_phi, intercept_delay, intercept_burn_duration, state0, k)

    ecc = state_final.ecc(k)
    alt_err = (np.linalg.norm(state_final.position)-oe.EARTH_RADIUS_KM-alt).value    
    return ecc*ecc + alt_err*alt_err


def maneuver_dist(x, state, r1, v1, k):
    t_burn_start, t_burn_duration, thrust_theta, thrust_phi = x

    # compute the post burn state
    param = oe.AccParams()
    param.thrust_vec = np.array(oe.spherical_to_cartesian(1, thrust_theta, thrust_phi))
    state_preburn = state.cowell(k, t_burn_start*u.s)
    state_postburn = state_preburn.cowell(k, t_burn_duration*u.s, acc_params=param)

    # compute the target post burn state
    state_intersect.velocity = v1
    target_postburn = state_intersect.cowell(k, t_burn_start*u.s + t_burn_duration*u.s)

    # compute the distance between the two states
    dr = state_postburn.position - target_postburn.position
    dv = state_postburn.velocity - target_postburn.velocity
    
    dv_mag = np.linalg.norm(dv).value
    dr_mag = np.linalg.norm(dr).value

    return dv_mag*dv_mag + dr_mag*dr_mag

from poliastro import iod

def compute_dv(x0, state, state_target, k):
    t_start, t_flight = x0
    t_start *= u.s
    t_flight *= u.s


    state1 = state.cowell(k, t_start)
    state1_target = state_target.cowell(k, t_start + t_flight)

    res = list(iod.izzo.lambert(Earth.k, state1.position, state1_target.position, t_flight, M=0))
    if len(res) == 0 or len(res) > 1:
        raise RuntimeError(f"compute_totaldv labert produced {len(res)} solutions")

    v1_sol, v2_sol = res[0]

    # take off vector must be in director of normal vector for take off
    dv1 = np.linalg.norm(state1.velocity - v1_sol)
    dv2 = np.linalg.norm(state1_target.velocity - v2_sol)
    return  (dv1 + dv2)

def lambertSearch(state, state_target,k, bounds=[None, None], resolution=5, show=False):

    t_start = 100*u.s
    t_stop = 1000*u.s

    if bounds[0] is None:
        bounds[0] = 12*3600
    if bounds[1] is None:
        bounds[1] = 500

    # search for the starting point
    t_start = np.linspace(t_start.to(u.s).value, bounds[0], resolution)
    t_flight = np.linspace(200, bounds[1], resolution)

    data = np.zeros((len(t_flight), len(t_start)))
    for i in range(len(t_start)):
        for j in range(len(t_flight)):
            data[i, j] = compute_dv([t_start[i], t_flight[j]], state, state_target, k).value
    # Find the indices of the minimum value
    min_index = np.unravel_index(np.argmin(data), data.shape)
    min_value = data[min_index]
    guess = [t_start[min_index[0]], t_flight[min_index[1]]]

    if show:
        # Create the heat map
        plt.imshow(data, cmap='plasma', origin='lower', extent=[t_start.min(), t_start.max(), t_flight.min(), t_flight.max()])
        plt.colorbar(label='Value')
        #auto aspect ratio
        plt.gca().set_aspect('auto', adjustable='box')
        # Draw a dot on the minimum value
        plt.plot(t_start[min_index[1]], t_flight[min_index[0]], 'ro')

        # Uncomment the line below to add a colorbar
        # plt.colorbar(label='Value')

        plt.ylabel('t_flight')
        plt.xlabel('t_delay')
        plt.title('Energy')
        

        # Show the plot
        plt.show()

    return guess, min_value
#post launch
# r0 = np.array([6442.10116578,   86.01334177,   37.29261384] )*u.km
# v0 = np.array([1.00248566, 0.43470921, 0.18847591])*u.km/u.s

k = Earth.k.to(u.km**3/u.s**2)

# rocket on ground
r0 = np.array([oe.EARTH_RADIUS_KM.value, 0, 0])*u.km
v0 = np.array([0, oe.EARTH_RADIUS_KM.value*2*np.pi/(24*3600) , 0])*u.km/u.s
m0 = 350*u.kg # rocket + fuel
T0 = oe.TEMP_EARTH
isp = oe.SPECIFIC_IMPULSE_TYPE.Liquid
flow = oe.REACTION_MASS_FLOW_RATE
state0 = Body.State( r0, v0, m0, T0,0*u.s)

# compute a target in circular orbit
r_target = np.array([2*oe.EARTH_RADIUS_KM.value, 0, 0])*u.km
v_target = np.array([0, 5.59 , 0])*u.km/u.s
target_state0 = Body.State(r_target, v_target)

t_intercept = 500*u.s
state_intersect = state0.cowell(k, t_intercept)
dv = v_target - state_intersect.velocity
_, thrust_theta, thrust_phi = oe.cartesian_to_spherical(*dv)


state_target = state_intersect.cowell(k, 100*u.s)

print(state_target.position)

times = np.linspace(10, 1000, 100)*u.s
dv = []
for t in times:
    res = list(iod.izzo.lambert(Earth.k, r0, state_target.position, t, M=0))
    v0_sol, v1_sol = res[0]
    dv1 = np.linalg.norm(v0_sol - state0.velocity).value
    dv2 = np.linalg.norm(v1_sol - state_target.velocity).value

    dv.append(dv1+dv2)

plt.plot(times, dv)
plt.show

#lambertSearch(state0, target_state0, k, resolution=50, show=True)

# x0 = [100, 200, thrust_theta.value, thrust_phi.value]  
# bounds = [(1, 1000), (1, 1000), (0, 2*np.pi), (0, np.pi)] 
# print(maneuver_dist(x0, state0, state_intersect.position, v_target, k))
# res = minimize(maneuver_dist, x0, args=(state0, state_intersect.position, v_target, k), bounds=bounds)
# print(res.fun, res.x)
exit()


# res = minimize(lambda v,r,k: oe.eccentricity(v,r,k)**2, v_target, args=(r_target.value, k.value))
# v_target = res.x*u.km/u.s
# print(v_target)
#ecc = oe.eccentricity(v_target.value, r_target.value, k.value)



# create a guess launch intercept maneuver
launch_delay = 10*u.s
launch_burn_duration = 420*u.s
intercept_burn_theta = 1.6
intercept_burn_phi = 0.3
intercept_delay = 90*u.s
intercept_burn_duration = 150*u.s

x0 = [launch_delay.value, launch_burn_duration.value, intercept_burn_theta, intercept_burn_phi, intercept_delay.value, intercept_burn_duration.value]
print('guess:',x0)

# print(x0)
# print(*state0.to_list())
res = post_launch_intercept_maneuver(*x0, state0, k)
print(res)
print(res.ecc(k))




score = post_launch_intercept_score(x0, state0, k, target_state0) 
print("Guess Score:",score) 



times = np.linspace(0, 300, 100)
positions = []
target_positions = []
for t in times:
    state = state0.cowell(k, t*u.s)
    positions.append(np.linalg.norm(state.position).value)
    target_state = target_state0.cowell(k, t*u.s)
    target_positions.append(np.linalg.norm(target_state.position).value)

# #extract positions fo
# positions = np.linalg.norm(states.position, axis=1)

import matplotlib.pyplot as plt
plt.plot(times, positions)
plt.plot(times, target_positions)
plt.show()


# res = minimize(post_launch_intercept_score, x0, args=(state0, k, target_state0))
# print("Post X:",res.x)
# print("Post Optimized Score: ",res.fun)

exit()

# create a guess maneuver




target_alt = 400*u.km

print(state0)
#print("Pre Ecc:", eccentricity(v0.value, r0.value, k.value))
#print("Pre Ecc:", state0.ecc(k))

# print("Guess Angle:",guess_angle)
prograde_vec = state0.prograde_vector()
tangent_vec = state0.tangent_vector()
guess_angle = np.arccos(np.dot(prograde_vec, tangent_vec))
guess_velocity = np.sqrt(k/np.linalg.norm(r0)) #circular orbit velocity
guess_dv = guess_velocity*np.dot(tangent_vec,prograde_vec) # how much dv is still needed
max_accel = state0.max_accel(isp, flow)
guess_t_circularize = guess_dv/max_accel

guess_t_launch = 200*u.s
guess_t_circularize = 200*u.s
x0 = [guess_t_launch.value, guess_angle.value, guess_t_circularize.value] # angle, time

#x0 = [305.06579646,   0.47570277,  69.23180498]
print('guess:',x0)
r,v,m,temp = post_launch_maneuver(*x0, *state0.to_list(), k) 
print('Pre Optimized Alt:',np.linalg.norm(r)-oe.EARTH_RADIUS_KM)
print('Pre Optimized Ecc:',oe.eccentricity(v.value, r.value, k.value))

score = post_launch_maneuver_score(x0, *state0.to_list(), k, target_alt)
print("Guess Score:",score)
ts_start = time.time()
res = minimize(post_launch_maneuver_score, x0, args=(*state0.to_list(), k, target_alt))
ts_end = time.time()
print("Time to optimize:",ts_end-ts_start)
print("Post X:",res.x)
print("Post Optimized Score: ",res.fun)


res = post_launch_maneuver(*res.x, *state0.to_list(), k) 
state2 = Body.State(*res,0*u.s)
print('Post Optimized Alt:',np.linalg.norm(state2.position)-oe.EARTH_RADIUS_KM)
print('Post Optimized Ecc:',state2.ecc(k))
print('Post Optimized Mass:',state2.mass)


# r,v,m,temp = post_planar_maneuver(*res.x, *state0.to_list(), k)
# print("Post Optimized Vel: ",np.linalg.norm(v))
# print("Post Optimized Alt: ",np.linalg.norm(r)-oe.EARTH_RADIUS_KM)
# print("Post Optimized Mass:",m)
# print("Post Optimized Temp:",temp)


# x0 = [guess_angle.value, guess_dt.value] # angle, time
# ecc = post_planar_maneuver_ecc(x0, *state0.to_list(), k)
# print(x0)
# print("Guess Ecc:",ecc)
# ts_start = time.time()
# res = minimize(post_planar_maneuver_ecc, x0, args=(*state0.to_list(), k))
# ts_end = time.time()
# print("Time to optimize:",ts_end-ts_start)
# print("Post Optimized Ecc: ",res.fun)

# r,v,m,temp = post_planar_maneuver(*res.x, *state0.to_list(), k)
# print("Post Optimized Vel: ",np.linalg.norm(v))
# print("Post Optimized Alt: ",np.linalg.norm(r)-oe.EARTH_RADIUS_KM)
# print("Post Optimized Mass:",m)
# print("Post Optimized Temp:",temp)