import torch
import torchdiffeq as diffeq
import orbitengine.engine as oe

from poliastro.bodies import Earth
from astropy import units as u
import numpy as np

# Define the Lotka-Volterra dynamics
def lotka_volterra(t, population):
    x, y = population
    alpha = 0.2
    beta = 0.025
    delta = 0.01
    gamma = 0.6
    dxdt = alpha * x - beta * x * y
    dydt = delta * x * y - gamma * y
    return torch.tensor([dxdt, dydt])


def twobody(t0, u_, k, acc_params):
    """Differential equation for the initial value two body problem.

    This function follows Cowell's formulation from poliastro

    Parameters
    ----------
    t0 : float
        Time.
    u_ : ~numpy.ndarray
        Six component state vector [x, y, z, vx, vy, vz] (km, km/s).
        plus mass and temperature
    k : float
        Standard gravitational parameter.
    acc_params : 
        parameters to control the acceleration
    """
    ax, ay, az, dm, dT = acc_params.func(t0, u_, k)

    x, y, z, vx, vy, vz, mass, temp = u_
    r3 = (x**2 + y**2 + z**2)**1.5

    # need to suppport this for elliptical orbits as well
#    dT += -TEMP_RADIANT_CONSTANT*(temp-TEMP_SPACE) #cooling to space temp

    du = torch.tensor([
        vx,
        vy,
        vz,
        -k * x / r3 + ax,
        -k * y / r3 + ay,
        -k * z / r3 + az,
        dm,
        dT
    ])

    return du


#on ground
r0 = np.array([oe.EARTH_RADIUS_KM.value, 0, 0])*u.km
v0 = np.array([0, oe.EARTH_RADIUS_KM.value*2*np.pi/(24*3600) , 0])*u.km/u.s

k = Earth.k.to(u.km**3/u.s**2)
m0 = 350*u.kg # rocket + fuel
T0 = oe.TEMP_EARTH
isp = oe.SPECIFIC_IMPULSE_TYPE.Liquid
flow = oe.REACTION_MASS_FLOW_RATE

target_alt = 400*u.km

u0 = torch.tensor([*r0.value, *v0.value, m0.value, T0.value])  # Initial state

t_span = torch.linspace(0., 200., 100)

acc_params2 = oe.AccParams()
acc_params2.thrust_vec = torch.tensor([1., 0., 0.])
k = Earth.k.to(u.km**3/u.s**2).value

# Solve the ODE
#solution = diffeq.odeint(lotka_volterra, u0, t_span, args=()method='dopri5')
solution = diffeq.odeint(lambda y,t: twobody(y,t, k, acc_params2), u0, t_span, method='dopri5')

# Plot the results (requires matplotlib)
import matplotlib.pyplot as plt


position = solution[:, :3]
#compute magnitude of position
r = torch.norm(position, dim=1)

plt.plot(t_span, r, label='Position Mag')
plt.xlabel('Time')
plt.ylabel('Km')
plt.legend()
plt.show()

