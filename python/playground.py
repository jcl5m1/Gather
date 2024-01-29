import numpy as np
from poliastro.bodies import Earth
from astropy import units as u
import poliastro as pa
import orbitengine as oe
from astropy.constants import M_earth
from scipy.integrate import ode
import matplotlib.pyplot as plt
from poliastro import iod
import time
from scipy.optimize import minimize

np.set_printoptions(precision=3)


def randomize(dist, vel):
    # random 3d unit vector
    theta = np.random.uniform(0,2*np.pi)
    phi = np.random.uniform(-np.pi/2,np.pi/2)
    r = oe.spherical_to_cartesian(dist.to(u.km).value, theta, phi)

    theta = np.random.uniform(0,2*np.pi)
    phi = np.random.uniform(-np.pi/2,np.pi/2)
    v = oe.spherical_to_cartesian(vel.to(u.km/u.s).value, theta, phi)
    r = r*u.km
    v = v*u.km/u.s

    return oe.Orbit.from_vectors(Earth, r,v)


o1 = randomize(2*oe.EARTH_RADIUS.to(u.km), 5*u.km/u.s)
o2 = randomize(5*oe.EARTH_RADIUS.to(u.km), 3*u.km/u.s)
print(o1, o1.period.to(u.s))
print(o2, o2.period.to(u.s))
per = 2*np.max([o1.period.to(u.s).value, o2.period.to(u.s).value])

def compute_dv(x0, orbit1, orbit2):
    t_start, t_flight = x0
    t_start *= u.s
    t_flight *= u.s

    r1, v1 = orbit1.propagate(t_start).rv()
    r2, v2 = orbit2.propagate(t_start + t_flight).rv()

    res = list(iod.izzo.lambert(Earth.k, r1, r2, t_flight, M=0))
    if len(res) == 0 or len(res) > 1:
        raise RuntimeError(f"compute_totaldv labert produced {len(res)} solutions")

    v1_sol, v2_sol = res[0]
    dv1 = np.linalg.norm(v1 - v1_sol)
    dv2 = np.linalg.norm(v2 - v2_sol)
    return  (dv1 + dv2).value

def porkchop(orbit1, orbit2, resolution=5, show=False):

    period = 2*np.max([orbit1.period.to(u.s).value, orbit2.period.to(u.s).value])
    # Generate some random data for the heat map
    guess = [period/2, period/2]
    radius = period/2

    # search for the starting point
    t_start = np.linspace(guess[1] - radius, guess[1] + radius, resolution)
    t_flight = np.linspace(guess[0] - radius*.9, guess[0] + radius*.9, resolution)
    data = np.zeros((len(t_flight), len(t_start)))
    for i in range(len(t_start)):
        for j in range(len(t_flight)):
            data[i, j] = compute_dv([t_start[i], t_flight[j]], orbit1, orbit2)
    # Find the indices of the minimum value
    min_index = np.unravel_index(np.argmin(data), data.shape)
    min_value = data[min_index]
    guess = [t_start[min_index[0]], t_flight[min_index[1]]]

    if show:
        # Create the heat map
        plt.imshow(data, cmap='plasma', origin='lower', extent=[t_start.min(), t_start.max(), t_flight.min(), t_flight.max()])

        # Draw a dot on the minimum value
        plt.plot(t_start[min_index[1]], t_flight[min_index[0]], 'ro')

        # Uncomment the line below to add a colorbar
        # plt.colorbar(label='Value')

        plt.xlabel('t_flight')
        plt.ylabel('t_delay')
        plt.title('Energy')

        # Show the plot
        plt.show()

    return guess, min_value

guess, min_value = porkchop(o1,o2, 5, show=False)
print(guess, min_value)

bounds = [(0,2*per), (1,2*per)]
res = minimize(compute_dv, guess, args=(o1,o2), bounds=bounds)
print(res.x, res.fun)