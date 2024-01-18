import numpy as np
from astropy import units as u
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
from poliastro.maneuver import Maneuver

alt_i = 700 * u.km  # Initial altitude
inc_i = 20 * u.deg  # Initial inclination
alt_f = 36000 * u.km  # Final altitude
inc_f = 45 * u.deg  # Final inclination

orbit_i = Orbit.from_classical(Earth, alt=alt_i, inc=inc_i,raan=0 * u.deg, argp=0 * u.deg, nu=0 * u.deg)
orbit_f = Orbit.from_classical(Earth, alt=alt_f, inc=inc_f,raan=0 * u.deg, argp=0 * u.deg, nu=0 * u.deg)

maneuver = Maneuver.lambert(orbit_i, orbit_f, time_of_flight=4 * u.h)  # Example time of flight

orbit_f = orbit_i.apply_maneuver(maneuver)

print(maneuver.get_total_cost())  # Total delta-v
print(maneuver.get_total_time())  # Transfer time
