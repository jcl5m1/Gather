import numpy as np
import orbitengine.engine as oe
import astropy.units as u
from poliastro.bodies import Earth
from scipy.optimize import minimize
from orbitengine.body import Body
from orbitengine.transfer import TransferSolver, ThrustManeuver
import unittest
import time

EPSILON = 1e-5
CACHE_MAX_TIME = 0.1

np.set_printoptions(precision=2)

# rocket on ground
r0 = np.array([oe.EARTH_RADIUS_KM.value, 0, 0])*u.km
ground_velocity = oe.EARTH_RADIUS_KM*2*np.pi/(24*3600*u.s)
v0 = np.array([0, ground_velocity.value, 0])*u.km/u.s
m0 = 100000*u.kg # rocket + fuel
T0 = oe.TEMP_EARTH

isp = oe.SPECIFIC_IMPULSE_TYPE.Liquid
dry_mass =  5000*u.kg #rocket only
flow_rate = 1.0*oe.FALCON9_REACTION_MASS_FLOW_RATE


state_launch = Body.State( r0, v0, m0, T0, parent_axis_angle=oe.EARTH_AXIS_ANGLE)
# compute a target in circular orbit
state_leo = Body.State(np.array([-oe.ALTITUDE_LEO.value, 0, 0])*u.km,
                    np.array([0, -5, 0])*u.km/u.s,   # guess
                        m0,
                        T0).circularized(oe.EARTH_K)
state_geo = Body.State(np.array([-oe.ALTITUDE_GEO.value, 0, 0])*u.km,
                    np.array([0, -5, 0])*u.km/u.s,   # guess
                        m0,
                        T0).circularized(oe.EARTH_K)

class TestTransferSolver(unittest.TestCase):
    def test_circularize(self):
        self.assertLess(state_leo.ecc(oe.EARTH_K), EPSILON)

    def transfer_solve(self, state_init, state_target, isp, dry_mass, flow_rate, plot=False, cache=False, verbose=False):
        solver = TransferSolver(state_init, state_target, oe.EARTH_K, time_weight=0.0001)
        #solver = TransferSolver(state_leo, state_geo, oe.EARTH_K, time_weight=0.0001)
        res = solver.lambert_search(resolution=10, plot=plot, cache=cache)

        # compute thrust limited maneuvers
        res = solver.compute_thrust_maneuvers(flow_rate, isp, dry_mass, verbose=verbose, cache=cache)

        self.assertIsNotNone(res)

        if verbose:
            state, err = res
            oe.print(state)
            oe.print(f"Post M1 mass: {solver.maneuver1.state_post_maneuver.mass:.02f}")
            oe.print(f"Post M2 mass: {solver.maneuver2.state_post_maneuver.mass:.02f}")
            oe.print(f"m1_dV:{solver.dv1:.02f} m2_dV:{solver.dv2:.02f}  total_dV: {solver.dv1+solver.dv2:.02f}")
            oe.print(f"Initial Mass: {m0:.02f} Final Mass: {state.mass:.02f}")
            oe.print(f"Reaction Mass Remaining: {state.mass - dry_mass}")
            oe.print(f"Delay, Flight: {solver.t_delay:.02f}, {solver.t_flight:.02f}")
            oe.print(f"m1_init_burn: {solver.maneuver1.t_init_burn:.02f}, m1_correction_burn: {solver.maneuver1.t_correction_burn:.02f}, alignment_err: {solver.maneuver1.alignment_err}")
            oe.print(f"m2_init_burn: {solver.maneuver2.t_init_burn:.02f}, m2_correction_burn: {solver.maneuver2.t_correction_burn:.02f}, alignment_err: {solver.maneuver2.alignment_err}")
        if plot:
            solver.plot_thrust_transfer_trajectory(show_maneuvers=True, t_postfix=100*u.s)

        self.assertLess(solver.maneuver1.alignment_err, EPSILON)
        self.assertLess(solver.maneuver2.alignment_err, EPSILON)

    def test_transfer_solve_leo(self, plot = False, cache=False, verbose=False):        
        self.transfer_solve(state_launch, state_leo, isp, dry_mass, flow_rate, plot=plot, cache=cache, verbose=verbose)

    def test_transfer_solve_geo(self, plot = False, cache=False, verbose=False):
        self.transfer_solve(state_leo, state_geo, isp, dry_mass, flow_rate, plot=plot, cache=cache, verbose=verbose)

    def test_cache(self):
        self.test_transfer_solve_leo(cache=True)
        start = time.time()
        self.test_transfer_solve_leo(cache=True)
        stop = time.time()
        print(f"Cache time: {stop-start}")
        self.assertLess(stop-start, CACHE_MAX_TIME)


if __name__ == '__main__':
    # run tests verbose
    unittest.main(verbosity=2)
