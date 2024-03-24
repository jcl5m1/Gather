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
    target_postburn = state_intersect.propagate_cowell(k, t_burn_start*u.s + t_burn_duration*u.s)

    # compute the distance between the two states
    dr = state_postburn.position - target_postburn.position
    dv = state_postburn.velocity - target_postburn.velocity
    
    dv_mag = np.linalg.norm(dv).value
    dr_mag = np.linalg.norm(dr).value

    return dv_mag*dv_mag + dr_mag*dr_mag

from poliastro import iod

# def compute_dv(x0, state, state_target, k):
#     t_start, t_flight = x0
#     t_start *= u.s
#     t_flight *= u.s


#     state1 = state.cowell(k, t_start)
#     state1_target = state_target.cowell(k, t_start + t_flight)

#     res = list(iod.izzo.lambert(Earth.k, state1.position, state1_target.position, t_flight, M=0))
#     if len(res) == 0 or len(res) > 1:
#         raise RuntimeError(f"compute_totaldv labert produced {len(res)} solutions")

#     v1_sol, v2_sol = res[0]

#     # take off vector must be in director of normal vector for take off
#     dv1 = np.linalg.norm(state1.velocity - v1_sol)
#     dv2 = np.linalg.norm(state1_target.velocity - v2_sol)
#     return  (dv1 + dv2)

# def lambertSearch(state, state_target,k, bounds=[None, None], resolution=5, show=False):

#     t_start = 100*u.s
#     t_stop = 1000*u.s

#     if bounds[0] is None:
#         bounds[0] = 12*3600
#     if bounds[1] is None:
#         bounds[1] = 500

#     # search for the starting point
#     t_start = np.linspace(t_start.to(u.s).value, bounds[0], resolution)
#     t_flight = np.linspace(200, bounds[1], resolution)

#     data = np.zeros((len(t_flight), len(t_start)))
#     for i in range(len(t_start)):
#         for j in range(len(t_flight)):
#             data[i, j] = compute_dv([t_start[i], t_flight[j]], state, state_target, k).value
#     # Find the indices of the minimum value
#     min_index = np.unravel_index(np.argmin(data), data.shape)
#     min_value = data[min_index]
#     guess = [t_start[min_index[0]], t_flight[min_index[1]]]

#     if show:
#         # Create the heat map
#         plt.imshow(data, cmap='plasma', origin='lower', extent=[t_start.min(), t_start.max(), t_flight.min(), t_flight.max()])
#         plt.colorbar(label='Value')
#         #auto aspect ratio
#         plt.gca().set_aspect('auto', adjustable='box')
#         # Draw a dot on the minimum value
#         plt.plot(t_start[min_index[1]], t_flight[min_index[0]], 'ro')

#         # Uncomment the line below to add a colorbar
#         # plt.colorbar(label='Value')

#         plt.ylabel('t_flight')
#         plt.xlabel('t_delay')
#         plt.title('Energy')
        

#         # Show the plot
#         plt.show()

#     return guess, min_value


def lambert_dv(x, state0, state0_target, k, t_wieght=0.0001):
    t, tof = x
    t *= u.s
    tof *= u.s
    state1 = state0.cowell(k, t)

    target1 = state0_target.cowell(k, t+tof)
    res = list(iod.izzo.lambert(Earth.k, state1.position, target1.position, tof, M=0))
    if len(res) == 0 or len(res) > 1:
        print(f"lambert produced {len(res)} solutions")
    v0_sol, v1_sol = res[0]
    dv1 = np.linalg.norm(v0_sol - state1.velocity).value
    dv2 = np.linalg.norm(v1_sol - target1.velocity).value
    dt = (t+tof).value*t_wieght

    return dv1*dv1+dv2*dv2+dt*dt


def lambert_dv_launch(x, state0, state0_target, k, planet_axis_angle, t_wieght=0.0001):
    t, tof = x
    t *= u.s
    tof *= u.s

    rot_mag = np.linalg.norm(planet_axis_angle)
    R.from_rotvec(planet_axis_angle*t)
    #apply to state0.position
    r1 = R.apply(state0.position)
    v1 = np.cross(planet_axis_angle,state0.position)
    v1 = rot_mag/np.linalg.norm(v1)
    v1 = R.apply(v1)
    
    state1 = Body.State(r1, v1)

    target1 = state0_target.cowell(k, t+tof)
    res = list(iod.izzo.lambert(Earth.k, state1.position, target1.position, tof, M=0))
    if len(res) == 0 or len(res) > 1:
        print(f"lambert produced {len(res)} solutions")
    v0_sol, v1_sol = res[0]
    dv1 = np.linalg.norm(v0_sol - state1.velocity).value
    dv2 = np.linalg.norm(v1_sol - target1.velocity).value
    dt = (t+tof).value*t_wieght

    return dv1*dv1+dv2*dv2+dt*dt



k = Earth.k.to(u.km**3/u.s**2)
earth_axis_angle = [0,0,2*np.pi/(24*3600)]*u.rad/u.s

# rocket on ground
r0 = np.array([oe.EARTH_RADIUS_KM.value, 0, 0])*u.km
v0 = np.array([0, 7.90538864 , 0])*u.km/u.s  # near circular orbit
# res = minimize(oe.eccentricity, v0.value, args=(r0.value, k.value))
# print(res.x)
ground_velocity = oe.EARTH_RADIUS_KM*2*np.pi/(24*3600*u.s)

m0 = 350*u.kg # rocket + fuel
T0 = oe.TEMP_EARTH
isp = oe.SPECIFIC_IMPULSE_TYPE.Liquid
flow = oe.FALCON9_REACTION_MASS_FLOW_RATE
state0 = Body.State( r0, v0, m0, T0,0*u.s)
per_source = state0.period(k)

t = 0
rot_mag = np.linalg.norm(earth_axis_angle)
R.from_rotvec(earth_axis_angle*t)
#apply to state0.position
r1 = R.apply(state0.position.value)
v1 = np.cross(earth_axis_angle,state0.position).value
v1 = rot_mag/np.linalg.norm(v1)
v1 = R.apply(v1.value)
state1 = Body.State(r1, v1)
print(state1)


# print(state0.ecc(k))
# print(state0.period(k))
# print(state0.position)
# print(state0.cowell(k, 5069.3*u.s).position)


# compute a target in circular orbit
r_target = np.array([0,2*oe.EARTH_RADIUS_KM.value,  0])*u.km
v_target = np.array([-5.59,0 , 0])*u.km/u.s
state0_target = Body.State(r_target, v_target)
per_target = state0_target.period(k)


max_time = 10000*u.s
if not np.isnan(per_source) and not np.isnan(per_target):
    if per_source > per_target:
        max_time = per_source
    else:
        max_time = per_target


# t_intercept = 500*u.s
# state_intersect = state0.cowell(k, t_intercept)
# dv = v_target - state_intersect.velocity
# _, thrust_theta, thrust_phi = oe.cartesian_to_spherical(*dv)

#use priods to define search bounds
travel_max = max_time.value
delay_max = max_time.value
time_weight = 0.0005
resolution = 20
travel_times = np.linspace(1000, travel_max, resolution)*u.s
delay_times = np.linspace(100, delay_max, resolution)*u.s
dv = np.zeros((len(delay_times), len(travel_times)))
positions = []
positions_target = []
positions_intercept = []

position_times = np.linspace(10, travel_max+delay_max, 200)*u.s



for pos_idx in range(len(position_times)):
    t = position_times[pos_idx]
    state1 = state0.propagate_cowell(k, t)
    target1 = state0_target.propagate_cowell(k, t)
    positions.append(state1.position)
    positions_target.append(target1.position)

for delay_idx in range(len(delay_times)):
    for tof_idx in range(len(travel_times)):
        res = lambert_dv([delay_times[delay_idx].value, 
                          travel_times[tof_idx].value], 
                          state0, state0_target, 
                          k, 
                          t_wieght=time_weight, 
                          set_velocity=ground_velocity)
        dv[tof_idx,delay_idx] = np.log(res)

fig, axs = plt.subplots(1, 2, figsize=(10, 5))

# Plot 1: DV as image
axs[0].imshow(dv, cmap='plasma', origin='lower', extent=[delay_times.min().value, delay_times.max().value,travel_times.min().value, travel_times.max().value])

axs[0].set_ylabel('tof')
axs[0].set_xlabel('delay')
axs[0].set_title('Lambert DV')
axs[0].grid(True)
axs[0].set_aspect('auto', adjustable='box')

# plot the minimum dv
min_indices = np.unravel_index(np.argmin(dv), dv.shape)

delay_min_dv = delay_times[min_indices[1]]
travel_min_dv = travel_times[min_indices[0]]
axs[0].plot(delay_min_dv, travel_min_dv,  'ro')

x0 = [delay_min_dv.value,travel_min_dv.value]
bounds = [[0, delay_max], [0, travel_max]]
res = minimize(lambert_dv, x0, args=(state0, state0_target, k,time_weight,ground_velocity), bounds=bounds)
axs[0].plot(res.x[0], res.x[1],  'go')

# Plot 2: Line scatter plot
axs[1].plot([p[0].value for p in positions], [p[1].value for p in positions], label='Rocket')
axs[1].plot([p[0].value for p in positions_target], [p[1].value for p in positions_target], label='Target')

res = list(iod.izzo.lambert(Earth.k, state0.propagate_cowell(k, delay_min_dv).position, state0_target.propagate_cowell(k, delay_min_dv+travel_min_dv).position, travel_min_dv, M=0))
state_intersect = Body.State(state0.propagate_cowell(k, delay_min_dv).position, res[0][0])
for t in np.linspace(0, travel_min_dv, 100):
    positions_intercept.append(state_intersect.propagate_cowell(k,t).position)

axs[1].plot([p[0].value for p in positions_intercept], [p[1].value for p in positions_intercept], label='Intercept')
circle = plt.Circle((0, 0), oe.EARTH_RADIUS_KM.value, color='b', fill=False, linestyle='dotted')
axs[1].add_artist(circle)
axs[1].set_aspect('equal', adjustable='box')

plt.show()