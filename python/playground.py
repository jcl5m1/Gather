import numpy as np
import matplotlib.pyplot as plt
from scipy.integrate import odeint
from scipy.integrate import solve_ivp
from scipy.optimize import minimize
import matplotlib.gridspec as gridspec
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
from astropy import units as u

np.set_printoptions(precision=2)

# # Define the system of ODEs
# def rocket_equation(y, t):
#     position = y[0:3]
#     velocity = y[3:6]
#     mass = y[6]
#     g = 9.81  # m/s^2, acceleration due to gravity
#     thrust = 20000  # N, thrust force
#     dm_dt = -0.01  # kg/s, rate of change of mass
#     # The acceleration of the rocket is the sum of the acceleration due to thrust and the acceleration due to gravity
#     acceleration = np.array([0,1,0])*(thrust / mass - g)
# #    velocity = velocity + acceleration * t
#     res = np.concatenate([velocity, acceleration, np.array([dm_dt])])
#     print(res)
#     return res

# # Initial conditions
# position_0 = np.array([0,0,0])  # m
# velocity_0 = np.array([0,1,0])  # m/s
# mass_0 = np.array([1000])  # kg

# # Points in time for which to solve for y
# t = np.linspace(0, 100, 100)  # s

# # Solve the system of ODEs
# y0 = np.concatenate((position_0, velocity_0, mass_0))  # Update the size of y0
# y = odeint(rocket_equation, y0, t)

# # Extract the position, velocity, and mass from the solution
# position = y[:, 0]
# velocity = y[:, 1]
# mass = y[:, 2]

# # Print the final position, velocity, and mass
# print("Final position:", position[-1])
# print("Final velocity:", velocity[-1])
# print("Final mass:", mass[-1])

# # Plot the trajectory
# plt.figure()
# plt.plot(t, position)
# plt.xlabel("Time (s)")
# plt.ylabel("Position (m)")
# plt.show()

EARTH_RADIUS_M = 6371000
ROCKET_DRY_MASS = 10
G = 6.67430e-11  # m^3 kg^-1 s^-2, gravitational constant
M = 5.972e24  # kg, mass of the Earth
FUEL_THRUST_EFFICIENCY = 5000 # N/kg    
FUEL_MASS = 100
FUEL_MASS_CONSUMPTION_RATE = 0.25# kg/s
BURN_TIME = 389
STOP_TIME = 500
STEPS = 5000
TURN_ALTITUDE_M = 100000
EPSILON = 1e-6
TARGET_BURN_Y = -0.34


def eccentricity(r,v):
    r = np.linalg.norm(position)
    v = np.linalg.norm(velocity)
    g = G*M/r**2
    h = r*v
    E = v**2 / 2 - G * M / r
    e = np.sqrt(1 + 2 * E * h**2 / g)
    return e
    

def launch_dynamics(t,y, target_r0, target_v0, t_burn):
    r = y[0:3]
    v = y[3:6]
    mass = y[6]


    #compute eccentricity
    r_mag = np.linalg.norm(r)
    norm_vec = r/r_mag
    k = G*M
    e = ((v.dot(v) - k / r_mag) * r - r.dot(v) * v) / k
    ecc = np.linalg.norm(e)

    g = G*M/r_mag**2

 #   orbit = Orbit.from_vectors(Earth, r*u.m, v*u.m/u.s)
#    print(f"t:{t:.2f} E: {e} Eccentricity^2: {ecc:.2f} PA e:{orbit.ecc:.2f}")

    dv_vec = (target_v0-v)
    dv_mag = np.linalg.norm(dv_vec)

    target_vec = target_v0/np.linalg.norm(target_v0)

    thrust = FUEL_THRUST_EFFICIENCY * FUEL_MASS_CONSUMPTION_RATE
    alt = r_mag-EARTH_RADIUS_M
    target_alt = TURN_ALTITUDE_M # m
    i = 0
    if alt > TURN_ALTITUDE_M:
        i= 1

    drdt = np.array(v)

#    print(f"t:{t:.2f}\tecc: {ecc:.5f}")
    if mass > ROCKET_DRY_MASS and t < t_burn:
#    if mass > ROCKET_DRY_MASS and ecc > 0.01: #trying to stop the burn when eccentricity is is close to zero, but doesn't seem to work
        dv_vec /= dv_mag
        lerp_vec = norm_vec*(1-i) + target_vec*i
        acc = lerp_vec*thrust/mass-norm_vec*g
        dvdt = np.array(acc) 
        dmdt = np.array([-FUEL_MASS_CONSUMPTION_RATE])
    else:
        acc = -norm_vec*g # no thrust, just gravity
        dvdt = np.array(acc) 
        dmdt = np.array([0])
    return np.concatenate((drdt, dvdt, dmdt))


target_r0 = np.array([0.00000000e+00, 1.8e+07, 0.00000000e+00])  # m
#target_v0 = np.array([5.00000000e+00, -0.795, 0.00000000e+00]) # m/s
target_v0 = np.array([5.00000000e+00, TARGET_BURN_Y, 0.00000000e+00]) # m/s

def spherical_to_cartesian(theta, phi):
    x = np.sin(theta)*np.cos(phi)
    y = np.sin(theta)*np.sin(phi)
    z = np.cos(theta)
    return np.array([x,y,z])


def target_error(x,y0, target_r0, target_v0):
    print(x)
    thrust_vec = spherical_to_cartesian(x[0], x[1])    
    t = np.linspace(0, x[2], 2)
    res = odeint(launch_dynamics, y0,t, args=(thrust_vec, None))
    position = res[-1, 0:3]
    velocity = res[-1, 3:6]

    position_error = np.linalg.norm(position-target_r0)
    velocity_error = np.linalg.norm(velocity-target_v0)
    return position_error*position_error + velocity_error*velocity_error

r0 = np.array([0,EARTH_RADIUS_M,0])  # m
v0 = np.array([EARTH_RADIUS_M*2*np.pi/(24*3600),0,0]) # m/s
m0 = np.array([ROCKET_DRY_MASS+FUEL_MASS])  # kg
y0 = np.concatenate((r0,v0,m0))  # Update the size of y0

thrust_vec = np.array([0,1,0])

# x0 = [np.pi/2,np.pi/2, STOP_TIME]
# x0 = [1.2,1.2, STOP_TIME-100]

# res = minimize(target_error, x0, args=(y0, target_r0, target_v0))
# print(res.x, res.fun)

acc = FUEL_THRUST_EFFICIENCY * FUEL_MASS_CONSUMPTION_RATE/(ROCKET_DRY_MASS+FUEL_MASS)
print(f"Net Acc: {acc - G*M/EARTH_RADIUS_M**2}")
if True:
    if acc < G*M/EARTH_RADIUS_M**2:
        print(f"Rocket cannot take off. Net acc:{acc}")
    else:
        t = np.linspace(0, STOP_TIME, STEPS)
#        y = odeint(launch_dynamics, y0,t, args=(target_r0, target_v0))
        y = solve_ivp(launch_dynamics, [0, STOP_TIME], y0, args=(target_r0, target_v0, BURN_TIME), method="LSODA", t_eval=t)
        position = np.linalg.norm(y.y[0:3,:],axis=0)
        alt = position-EARTH_RADIUS_M
        velocity = y.y[3:6,:]        
        mass = y.y[6,:]

        # Plot the solution
        import matplotlib.pyplot as plt
        t_marker1 = t[np.abs(position - (EARTH_RADIUS_M + TURN_ALTITUDE_M)).argmin()]
        t_marker2 = t[np.abs(t - BURN_TIME).argmin()]


        # creat subplots for position and mass

        fig = plt.figure(figsize=(15, 10))
        gs = gridspec.GridSpec(3, 2)

        # Create the subplots
        ax1 = plt.subplot(gs[0, 0])
        ax2 = plt.subplot(gs[1, 0])
        ax3 = plt.subplot(gs[2, 0])
        ax4 = plt.subplot(gs[:, 1])
        #set aspect ratio for ax4 to be 1:1
        ax4.set_aspect('equal', adjustable='box')

        # Plot the data
        ax1.plot(t, alt)
        ax2.plot(t, velocity.T)
        ax3.plot(t, mass)

        #2D scatter line plot for y[0] and y[1]
        ax4.plot(y.y[0,:], y.y[1,:], 'b-')

        #draw circle on ax4 with radius EARTH_RADIUS_M
        circle = plt.Circle((0, 0), EARTH_RADIUS_M, color='r', fill=False)
        ax4.add_artist(circle)


        # Set the labels
        ax1.set_ylabel('Altitude')
        ax2.set_ylabel('Velocity')
        ax3.set_ylabel('Mass')
        ax4.set_ylabel('Position')

        # Add the vertical lines
        ax1.axvline(x=t_marker1, color='r', linestyle='--')
        ax2.axvline(x=t_marker1, color='r', linestyle='--')
        ax3.axvline(x=t_marker1, color='r', linestyle='--')

        ax1.axvline(x=t_marker2, color='g', linestyle='--')
        ax2.axvline(x=t_marker2, color='g', linestyle='--')
        ax3.axvline(x=t_marker2, color='g', linestyle='--')

        # Show the plot
        plt.show()

#t = [0,300]
# t = np.linspace(0, STOP_TIME, 20)
# y = odeint(rocket_dynamics, y0,t, args=(thrust_vec, None))
# print(y[-1,0:6])
