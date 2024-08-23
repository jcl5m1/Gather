import numpy as np
import orbitengine.engine as oe
import astropy.units as u
from poliastro.bodies import Earth
from scipy.optimize import minimize
from orbitengine.body import Body
import time
from scipy.spatial.transform import Rotation as R
import matplotlib.pyplot as plt
from poliastro import iod
import pickle
import math
import os
import hashlib

class TransferSolver:
    def __init__(self, state_init, state_target, k, time_weight=0.0005):
        self.state_init = state_init
        self.state_target = state_target
        self.k = k
        self.time_weight = time_weight

    # used to generate hash for caching results 
    def input_dict(self):
        return {
            'state_init': self.state_init.to_dict(),
            'state_target': self.state_target.to_dict(),
            'k': self.k,
            'time_weight': self.time_weight,
        }

    def transfer_dv(self, x):
        t_delay, t_flight = x
        t_delay *= u.s
        t_flight *= u.s

        init_pre_transfer = self.state_init.propagate(self.k, t_delay)
        target_post_transfer = self.state_target.propagate(self.k, t_delay+t_flight)

        res = list(iod.izzo.lambert(Earth.k, init_pre_transfer.position, target_post_transfer.position, t_flight, M=0))
        if len(res) == 0 or len(res) > 1:
            print(f"lambert produced {len(res)} solutions")
        v0_sol, v1_sol = res[0]

        ground_penalty = 0
        #add cost for not being aligned with the surface normal on launch
        if self.state_init.parent_axis_angle is not None:
            ndot = np.dot(v0_sol/np.linalg.norm(v0_sol), init_pre_transfer.position/np.linalg.norm(init_pre_transfer.position))
            # must point slightly upwards from the surface
            if ndot < 0.1:
                ground_penalty = 10000  # arbitrary large number, is this sufficient?

        #add cost for not being aligned with the surface normal on land
        if self.state_target.parent_axis_angle is not None:
            ndot = np.dot(v1_sol/np.linalg.norm(v1_sol), target_post_transfer.position/np.linalg.norm(target_post_transfer.position))
            # must point slightly towards the surface
            if ndot > -0.1:
                ground_penalty = 10000

        dv1 = np.linalg.norm(v0_sol - init_pre_transfer.velocity).value
        dv2 = np.linalg.norm(v1_sol - target_post_transfer.velocity).value
        self.dv1 = dv1
        self.dv2 = dv2        
        dt = (t_delay+t_flight).value*self.time_weight

        return dv1*dv1+dv2*dv2+dt*dt + ground_penalty
    
    def plot_transfer_trajectory(self):
    
        fig, axs = plt.subplots(1, 1, figsize=(5, 5))
        # init positions --------------------------
        ts = np.linspace(0, self.t_delay, 100)
        ss = self.state_init.propagate(self.k,ts)
        axs.plot([s.position[0].value for s in ss], [s.position[1].value for s in ss], label='Init')

        # transfer positions --------------------------
        ts = np.linspace(0, self.t_flight, 100)
        ss = self.state_transfer.propagate(self.k,ts)
        axs.plot([s.position[0].value for s in ss], [s.position[1].value for s in ss], label='Transfer')

        # target positions --------------------------
        ts = np.linspace(0, 100*u.s, 100)
        ss = self.state_target.propagate(self.k,self.t_delay + self.t_flight + ts)
        axs.plot([s.position[0].value for s in ss], [s.position[1].value for s in ss], label='Target')

        circle = plt.Circle((0, 0), oe.EARTH_RADIUS_KM, color='b', fill=False, linestyle='dotted')
        axs.add_artist(circle)
        axs.set_aspect('equal', adjustable='box')
        axs.legend()
        plt.show()

    def lambert_search(self, min_delay=1, max_delay=None, min_tof=1, max_tof=None, resolution=5, plot=False, cache=False):

        if cache:
            if oe.obj_cache_load(self):

                if plot:
                    self.plot_transfer_trajectory()
                return self.t_delay, self.t_flight, self.state_transfer

        init_period = self.state_init.period(self.k)
        target_period = self.state_target.period(self.k)
        max_time = 10000*u.s
        if not np.isnan(init_period) and not np.isnan(target_period):
            if init_period > target_period:
                max_time = init_period
            else:
                max_time = target_period

        #use priods to define search bounds
        if max_tof is None:
            max_tof = max_time.value
        if max_delay is None:
            max_delay = max_time.value
        flight_times = np.linspace(min_tof, max_tof, resolution)*u.s
        delay_times = np.linspace(min_delay, max_delay, resolution)*u.s
        dv = np.zeros((len(delay_times), len(flight_times)))

        for delay_idx in range(len(delay_times)):
            for tof_idx in range(len(flight_times)):
                try:
                    res = self.transfer_dv([
                        delay_times[delay_idx].value, 
                        flight_times[tof_idx].value])
                    dv[tof_idx,delay_idx] = np.log(res)
                except Exception as e:
                    dv[tof_idx,delay_idx] = 9


        #init guess based on sampling
        min_indices = np.unravel_index(np.argmin(dv), dv.shape)
        t_delay_min_dv = delay_times[min_indices[1]]
        t_flight_min_dv = flight_times[min_indices[0]]

        # optimize minimum dv from initial guess
        x0 = [t_delay_min_dv.value,t_flight_min_dv.value]
        bounds = [[min_delay, max_delay], [min_tof, max_tof]]
        res = minimize(self.transfer_dv, x0, bounds=bounds)
        self.t_delay = res.x[0]*u.s
        self.t_flight = res.x[1]*u.s

        init_pre_transfer = self.state_init.propagate(self.k, self.t_delay)
        target_post_transfer = self.state_target.propagate(self.k, self.t_delay+self.t_flight)

        r1 = init_pre_transfer.position
        r2 = target_post_transfer.position
        res = list(iod.izzo.lambert(Earth.k, r1, r2, self.t_flight, M=0))
        v1_sol = res[0][0]
        self.state_transfer = Body.State(r1, v1_sol, self.state_init.mass, self.state_init.temperature, self.t_delay)

        if cache:
            oe.obj_cache_save(self)
                
        if plot:
            fig, axs = plt.subplots(1, 2, figsize=(10, 5))

            # Plot dv grid as image --------------------------
            axs[0].imshow(dv, cmap='plasma', origin='lower', extent=[delay_times.min().value, delay_times.max().value, flight_times.min().value, flight_times.max().value])

            # show color scale
            cbar = plt.colorbar(axs[0].imshow(dv, cmap='plasma', origin='lower', extent=[delay_times.min().value, delay_times.max().value, flight_times.min().value, flight_times.max().value]))
            cbar.set_label('log(dv)')

            axs[0].set_ylabel('tof')
            axs[0].set_xlabel('delay')
            axs[0].set_title('Lambert DV')
            axs[0].grid(True)
            axs[0].set_aspect('auto', adjustable='box')

            axs[0].plot(t_delay_min_dv, t_flight_min_dv,  'ro') # init guess
            axs[0].plot(self.t_delay, self.t_flight,  'go') # final optimized

            # init positions --------------------------
            positions_init = []
            for t in np.linspace(0, self.t_delay, 100):
                s = self.state_init.propagate(self.k,t)
                positions_init.append(s.position)
            axs[1].plot([p[0].value for p in positions_init], [p[1].value for p in positions_init], label='Init')

            # transfer positions --------------------------
            positions_transfer = []
            for t in np.linspace(0, self.t_flight, 100):
                positions_transfer.append(self.state_transfer.propagate(self.k,t).position)
            axs[1].plot([p[0].value for p in positions_transfer], [p[1].value for p in positions_transfer], label='Transfer')

            # target positions --------------------------
            positions_target = []
            for t in np.linspace(0, 100*u.s, 100):
                s = self.state_target.propagate(self.k,self.t_delay + self.t_flight + t)
                positions_target.append(s.position)
            axs[1].plot([p[0].value for p in positions_target], [p[1].value for p in positions_target], label='Target')

            circle = plt.Circle((0, 0), oe.EARTH_RADIUS_KM, color='b', fill=False, linestyle='dotted')
            axs[1].add_artist(circle)
            axs[1].set_aspect('equal', adjustable='box')
            plt.show()
        return self.t_delay, self.t_flight, self.state_transfer
    
    def compute_thrust_maneuvers(self, flow_rate, isp, dry_mass, alignment_tol=0.01, verbose=False, cache=False):
        # compute first thrust maneuver
        self.maneuver1 = ThrustManeuver(
            self.state_init, 
            self.state_transfer, 
            self.k, 
            self.t_delay, 
            flow_rate, 
            isp,
            dry_mass)
        err = self.maneuver1.optimize(verbose=verbose, cache=cache)
        if err > alignment_tol:
            print(f"Maneuver 1 failed to achieve trajectory alignment: {err:.05f} > {alignment_tol}")
            print(f"State post Maneuver 1:\n{self.maneuver1.state_post_maneuver}")

        # compute second thrust maneuver
        state_target_post_transfer = self.state_target.propagate(self.k, self.t_delay + self.t_flight)
        self.state_transfer.mass = self.maneuver1.state_post_maneuver.mass

        self.maneuver2 = ThrustManeuver(
            self.state_transfer, 
            state_target_post_transfer, 
            self.k, 
            self.t_flight, 
            flow_rate, 
            isp, 
            dry_mass)
        err = self.maneuver2.optimize(verbose=verbose, cache=cache)
        if err > alignment_tol:
            print(f"Maneuver 2 failed to achieve trajectory alignment: {err:.05f} > {alignment_tol}")
            print(f"State post Maneuver 2:\n{self.maneuver2.state_post_maneuver}")

        self.state_post_thrust_transfer = self.maneuver2.state_post_maneuver
        if self.maneuver1.alignment_err < alignment_tol and self.maneuver2.alignment_err < alignment_tol:
            # clean copy of state_target propogated
            state_target_prop = self.state_target.propagate(
                self.k, 
                self.t_delay + self.t_flight + self.maneuver2.t_correction_burn)
            self.state_post_thrust_transfer.position = state_target_prop.position
            self.state_post_thrust_transfer.velocity = state_target_prop.velocity
        return self.state_post_thrust_transfer, self.maneuver1.alignment_err+self.maneuver2.alignment_err

    def plot_thrust_transfer_trajectory(self, show_maneuvers=False, tween_count=100,t_postfix=0*u.s):
        if show_maneuvers:
            self.maneuver1.plot()
            self.maneuver1.plot_components()
            print(f"Post Maneuver Mass: {self.maneuver1.state_post_maneuver.mass}")
            self.maneuver2.plot()
            self.maneuver2.plot_components()
            print(f"Post Maneuver Mass: {self.maneuver2.state_post_maneuver.mass}")
            
        # accumulate maneuver states
        ts = np.linspace(self.maneuver1.t_correction_burn, 
                             self.t_flight-self.maneuver2.t_init_burn, 
                             tween_count)
        states_tween = self.state_transfer.propagate(self.k, ts)

        states_m1 = self.maneuver1.states()
        states_m2 = self.maneuver2.states()
        self.states_thrust_transfer = states_m1 + states_tween + states_m2


        #accumulate target states post maneuver
        ts =  np.linspace(0, t_postfix, tween_count)
        ss = self.state_target.propagate(self.k, 
                                        self.t_delay + self.t_flight + self.maneuver2.t_correction_burn + ts)
        self.states_thrust_transfer += ss

        fig, axs = plt.subplots(1, 1, figsize=(10, 10))
        axs.plot([s.position[0].value for s in self.states_thrust_transfer], 
                 [s.position[1].value for s in self.states_thrust_transfer], label='Transfer')

        p = states_m1[0].position.value
        axs.plot(p[0], p[1], 'ro')
        axs.text(p[0], p[1], 'init_start')
        p = states_m1[-1].position.value
        axs.plot(p[0], p[1], 'ro')
        axs.text(p[0], p[1], 'init_stop')

        p = states_m2[0].position.value
        axs.plot(p[0], p[1], 'go')
        axs.text(p[0], p[1], 'target_start')
        p = states_m2[-1].position.value
        axs.plot(p[0], p[1], 'go')
        axs.text(p[0], p[1], 'target_stop')

        circle = plt.Circle((0, 0), oe.EARTH_RADIUS_KM, color='b', fill=False, linestyle='dotted')
        axs.add_artist(circle)
        axs.set_aspect('equal', adjustable='box')
        axs.legend()
        plt.show()

        return self.state_post_thrust_transfer


class ThrustManeuver:
    def __init__(self, 
                 state_init, 
                 state_target, 
                 k, 
                 t_maneuver, 
                 flow_rate, 
                 isp, 
                 dry_mass):
        self.state_init = state_init  # state prior to the maneuver along which t_manuever if propagated
        self.state_target = state_target # target state post maneuver calculated from t_maneuver forward
        self.state_post_maneuver = None
        self.t_maneuver = t_maneuver # time of the instaneous maneuver
        self.k = k # gravitational parameter
        self.flow_rate = flow_rate # mass flow rate
        self.isp = isp # specific impulse
        self.mass_dry = dry_mass

        self.acc_param_init = oe.AccParams(thrust_vec=oe.ZERO_ANGLE_VECTOR,
                                reaction_flow_rate=self.flow_rate,
                                reaction_isp=self.isp,
                                mass_dry=self.mass_dry)
        self.acc_param_correction = oe.AccParams(thrust_vec=oe.ZERO_ANGLE_VECTOR,
                                reaction_flow_rate=self.flow_rate,
                                reaction_isp=self.isp,
                                mass_dry=self.mass_dry)
                
    # used to generate hash for caching results 
    def input_dict(self):
        return {
            'state_init': self.state_init.to_dict(),
            'state_target': self.state_target.to_dict(),
            'k': self.k,
            't_maneuver': self.t_maneuver,
            'flow_rate': self.flow_rate,
            'isp': self.isp,
            'mass_dry': self.mass_dry,
        }

    def maneuver_err(self, x):
        t_init_burn = x[0]*u.s
        t_correction_burn = x[1]*u.s
        thrust_vec_init = R.from_rotvec([0,0,x[2]]).apply(oe.ZERO_ANGLE_VECTOR)
        thrust_vec_correction = R.from_rotvec([0,0,x[3]]).apply(oe.ZERO_ANGLE_VECTOR)

        self.acc_param_init.thrust_vec = thrust_vec_init
        self.acc_param_correction.thrust_vec = thrust_vec_correction
        s0 = self.state_init.propagate(self.k, self.t_maneuver - t_init_burn)
        s1a = s0.propagate(self.k, t_init_burn, acc_params=self.acc_param_init)
        s1 = s1a.propagate(self.k, t_correction_burn, acc_params=self.acc_param_correction)

        self.state_post_maneuver = s1
        s2 = self.state_target.propagate(self.k, t_correction_burn)
        dr = np.linalg.norm(s1.position - s2.position).value
        dv = np.linalg.norm(s1.velocity - s2.velocity).value
        return dr*dr + dv*dv


    def optimize(self, x=None, verbose=False, cache=False):

        if cache:
            if oe.obj_cache_load(self):
                return self.alignment_err   

        state_intercept = self.state_init.propagate(self.k, self.t_maneuver)

        #initial guess
        dv = self.state_target.velocity - state_intercept.velocity
        acc = oe.EARTH_G0*self.isp * self.flow_rate/self.state_init.mass
        dv_mag = np.linalg.norm(dv)
        if x is None:
            t_init_burn = 0.25*dv_mag/acc  # 0.5 seemed to put it in a local minimum
            t_correction_burn = 1*t_init_burn
            dv_angle = math.atan2(dv[1].value, dv[0].value)
            init_thrust_angle = dv_angle
            correction_thrust_angle = dv_angle
            x = [t_init_burn.value, 
                 t_correction_burn.value, 
                 init_thrust_angle, 
                 correction_thrust_angle]


        bounds = [[0,(dv_mag/acc).value],[0,(dv_mag/acc).value],
                  [-2*np.pi,2*np.pi],[-2*np.pi,2*np.pi]]
        res = minimize(self.maneuver_err, 
                       x, 
                       method='Nelder-Mead', 
                       options={'maxiter': 2000}, 
                       bounds=bounds) 
        if verbose:
            print(f"Maneuver dv: {dv_mag}")
            print(f"Initial guess: {x}")
            print(f"Alignment Err: {res.fun}")
            print(res)
        self.t_init_burn = res.x[0]*u.s
        self.t_correction_burn = res.x[1]*u.s
        self.init_thrust_angle = res.x[2]
        self.correction_thrust_angle = res.x[3]
        self.alignment_err = res.fun            

        if cache:
            oe.obj_cache_save(self)

        return res.fun
    
    def states(self, count=50):
        # rocket trajectory
        thrust_vec_init = R.from_rotvec([0,0,self.init_thrust_angle]).apply(oe.ZERO_ANGLE_VECTOR)
        thrust_vec_correction = R.from_rotvec([0,0,self.correction_thrust_angle]).apply(oe.ZERO_ANGLE_VECTOR)

        self.acc_param_init.thrust_vec = thrust_vec_init
        self.acc_param_correction.thrust_vec = thrust_vec_correction

        state_init_burn = self.state_init.propagate(self.k, self.t_maneuver - self.t_init_burn)

        states_maneuver = []
        steps = int(count/2)
        ts = np.linspace(0, self.t_init_burn, steps)
        ss = state_init_burn.propagate(self.k,ts, acc_params=self.acc_param_init)
        states_maneuver += ss
        state_correction_burn = states_maneuver[-1]
        # shift allows even spacing of points in t 
        ts = np.linspace(self.t_correction_burn/steps, self.t_correction_burn, steps-1)
        ss = state_correction_burn.propagate(self.k,ts, acc_params=self.acc_param_correction)
        states_maneuver += ss

        return states_maneuver

    def plot_components(self):
        # plot components of the flight
        fig, axs = plt.subplots(nrows=4, sharex=True, figsize=(10,10))
        states_maneuver = self.states()
        accel = []
        for i in range(len(states_maneuver)-1):
            s1 = states_maneuver[i]
            s2 = states_maneuver[i+1]
            a = np.linalg.norm(s2.velocity-s1.velocity).value/(s2.timestamp - s1.timestamp).value
            accel.append(a)
        accel.append(accel[-1]) # pad to be equal length

        times = [s.timestamp.value for s in states_maneuver]-self.t_maneuver.value
        axs[0].plot(times, [np.linalg.norm(s.position).value - oe.EARTH_RADIUS_KM for s in states_maneuver])
        axs[0].title.set_text('Altitude')
        axs[1].plot(times, [np.linalg.norm(s.velocity).value for s in states_maneuver])
        axs[1].title.set_text('Velocity')
        axs[2].plot(times, [s.mass.value for s in states_maneuver])
        axs[2].title.set_text('Mass')
        axs[3].plot(times, accel)
        axs[3].title.set_text('Acceleration')
        plt.show()

    def plot(self, count=50):

        # compute and plot body trajectories
        states_init = []
        states_target = []
        fig, axs = plt.subplots(1, 1, figsize=(10, 10))

        states_maneuver = self.states()

        # init trajectory
        ts = np.linspace(self.t_maneuver-self.t_init_burn, self.t_maneuver, int(count/2))
        states_init = self.state_init.propagate(self.k,ts)

        #target trajectory
        ts =  np.linspace(0, self.t_correction_burn, int(count/2))
        states_target = self.state_target.propagate(self.k, ts)

        axs.plot([s.position[0].value for s in states_init], [s.position[1].value for s in states_init], label='Init')
        axs.plot([s.position[0].value for s in states_target], [s.position[1].value for s in states_target], label='Target')
        axs.plot([s.position[0].value for s in states_maneuver], [s.position[1].value for s in states_maneuver], label='Maneuver')

        # show legend
        axs.legend()

        p = states_maneuver[0].position
        axs.plot(p[0], p[1], 'ro')
        axs.text(p[0].value, p[1].value, 'init_start')

        # p = states_init[-1].position
        # axs.plot(p[0], p[1], 'ro')
        # axs.text(p[0].value, p[1].value, 'init_stop')

        p = self.state_target.position
        axs.plot(p[0], p[1], 'bo')
        axs.text(p[0].value, p[1].value, 'incercept')

        p = states_target[-1].position
        axs.plot(p[0], p[1], 'bo')
        axs.text(p[0].value, p[1].value, 'target_stop')

        p = states_maneuver[-1].position
        axs.plot(p[0], p[1], 'go')
        axs.text(p[0].value, p[1].value, 'maneuver_last')

        # add label for points        
        circle = plt.Circle((0, 0), oe.EARTH_RADIUS_KM, color='b', fill=False, linestyle='dotted')
#            axs.add_artist(circle)  # adds 8-9 sec delay, unsure why
        axs.set_aspect('equal', adjustable='box')


        plt.show()
