import numpy as np
import matplotlib.pyplot as plt
from scipy.integrate import odeint
from scipy.integrate import solve_ivp
from scipy.optimize import minimize
import matplotlib.gridspec as gridspec
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
from astropy import units as u
import scipy
import orbitengine as oe
np.set_printoptions(precision=2)

EARTH_RADIUS_M = 6371000
G = 6.67430e-11  # m^3 kg^-1 s^-2, gravitational constant
M = 5.972e24  # kg, mass of the Earth
ROCKET_DRY_MASS = 10
SPECIFIC_IMPULSE = 2000 # N/kg    
FUEL_MASS = 100
FUEL_MASS_FLOW_RATE = 0.25# kg/s
STOP_TIME = 500
STEPS = 5000
EPSILON = 1e-6
turn_altitude_m = 100000
turn_time = 100
burn_time = 300
target_angle = 0#-0.064
k = G*M

print(oe.G0)
print(oe.FUEL_MASS_FLOW_RATE)
print(oe.SPECIFIC_IMPULSE)
print(oe.G0*oe.FUEL_MASS_FLOW_RATE*oe.SPECIFIC_IMPULSE/(oe.ROCKET_DRY_MASS+oe.FUEL_MASS))
exit()
def eccentricity(k, r, v):
    r_mag = np.linalg.norm(r)
    e = ((v.dot(v) - k / r_mag) * r - r.dot(v) * v) / k
    ecc = np.linalg.norm(e)
    return ecc    

def launch_dynamics(t,y, insertion_angle, t_burn):    
    r = y[0:3]
    v = y[3:6]
    mass = y[6]

    #compute eccentricity
    r_mag = np.linalg.norm(r)
    g = k/r_mag**2
    norm_vec = r/r_mag  # could just use initial launch vector?
    insertion_vec = np.array([np.cos(insertion_angle), np.sin(insertion_angle), 0])

    thrust = g*SPECIFIC_IMPULSE * FUEL_MASS_FLOW_RATE
    alt = r_mag - EARTH_RADIUS_M

    if mass > ROCKET_DRY_MASS and t < t_burn:
        if alt < turn_altitude_m:
           acc = norm_vec*thrust/mass-norm_vec*g
        else:
            acc = insertion_vec*thrust/mass-norm_vec*g
        dvdt = np.array(acc) 
        dmdt = np.array([-FUEL_MASS_FLOW_RATE])
    else:
        acc = -norm_vec*g # no thrust, just gravity
        dvdt = np.array(acc) 
        dmdt = np.array([0])
    drdt = np.array(v)
    return np.concatenate((drdt, dvdt, dmdt))

def spherical_to_cartesian(theta, phi):
    x = np.sin(theta)*np.cos(phi)
    y = np.sin(theta)*np.sin(phi)
    z = np.cos(theta)
    return np.array([x,y,z])


def circularity_error(x,y0):
    insertion_angle = x[0]
    t_burn = x[1]
    delay = 100+t_burn # time to compute the eccentricity, should be well after the burn
    res = solve_ivp(launch_dynamics, [0, delay], y0, args=(insertion_angle, t_burn), method="LSODA", t_eval=[delay])
    r1 = res.y[0:3,-1]
    v1 = res.y[3:6,-1]
    ecc = eccentricity(k, r1, v1)
    r1_mag = np.linalg.norm(r1)

    return ecc*ecc

r0 = np.array([0,EARTH_RADIUS_M,0])  # m
v0 = np.array([EARTH_RADIUS_M*2*np.pi/(24*3600),0,0]) # m/s
m0 = np.array([ROCKET_DRY_MASS+FUEL_MASS])  # kg
y0 = np.concatenate((r0,v0,m0))  # Update the size of y0

x0 = [target_angle, burn_time]
res = minimize(circularity_error, x0, args=(y0), method='Nelder-Mead', tol=1e-6)
target_angle, burn_time = res.x
print(res.x, res.fun)


g = k/EARTH_RADIUS_M**2
acc = g*SPECIFIC_IMPULSE * FUEL_MASS_FLOW_RATE/(ROCKET_DRY_MASS+FUEL_MASS)
print(f"Net Acc: {acc - G*M/EARTH_RADIUS_M**2}")
if True:
    if acc < G*M/EARTH_RADIUS_M**2:
        print(f"Rocket cannot take off. Net acc:{acc}")
    else:
        t = np.linspace(0, STOP_TIME, STEPS)
        res = solve_ivp(launch_dynamics, [0, STOP_TIME], y0, args=(target_angle, burn_time), method="LSODA", t_eval=t)
        position = res.y[0:3,:]
        velocity = res.y[3:6,:]        
        mass = res.y[6,:]
        altitude = np.linalg.norm(position,axis=0)-EARTH_RADIUS_M

        # Plot the solution
        import matplotlib.pyplot as plt

        # find first time when altitude crosses TURN_ALTITUDE_M
        turn_time = 0
        for i in range(len(altitude)):
            if altitude[i] > turn_altitude_m:
                turn_time = t[i]
                break
        # burn_stop_index = np.abs(t - burn_time).argmin()
        # t_burn_stop = t[burn_stop_index]
        # r1 = position[:, burn_stop_index]
        # v1 = velocity[:, burn_stop_index]

        # creat subplots for position and mass
        fig = plt.figure(figsize=(12, 8))
        gs = gridspec.GridSpec(3, 2)

        # Create the subplots
        ax1 = plt.subplot(gs[0, 0])
        ax2 = plt.subplot(gs[1, 0])
        ax3 = plt.subplot(gs[2, 0])
        ax4 = plt.subplot(gs[:, 1])
        #set aspect ratio for ax4 to be 1:1
        ax4.set_aspect('equal', adjustable='box')

        # Plot the data
        ax1.plot(t, altitude)
        ax2.plot(t, velocity.T)
        ax3.plot(t, mass)

        #2D scatter line plot for y[0] and y[1]
        ax4.plot(res.y[0,:], res.y[1,:], 'b-')

        #draw circle on ax4 with radius EARTH_RADIUS_M
        circle = plt.Circle((0, 0), EARTH_RADIUS_M, color='r', fill=False)
        ax4.add_artist(circle)


        # Set the labels
        ax1.set_ylabel('Altitude')
        ax2.set_ylabel('Velocity')
        ax3.set_ylabel('Mass')
        ax4.set_ylabel('Position')

        # Add the vertical lines
        ax1.axvline(x=turn_time, color='r', linestyle='--')
        ax2.axvline(x=turn_time, color='r', linestyle='--')
        ax3.axvline(x=turn_time, color='r', linestyle='--')

        ax1.axvline(x=burn_time, color='g', linestyle='--')
        ax2.axvline(x=burn_time, color='g', linestyle='--')
        ax3.axvline(x=burn_time, color='g', linestyle='--')

        # Show the plot
        plt.show()
