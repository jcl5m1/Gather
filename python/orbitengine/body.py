from astropy import units as u
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
import numpy as np
from astropy import constants as const
from poliastro import iod
from scipy.optimize import fsolve
from scipy.spatial.transform import Rotation
import primatives
from panda3d.core import LVecBase4f, NodePath, LVecBase3f,GeomVertexReader, GeomVertexWriter, GeomVertexData, GeomTriangles, GeomNode, LQuaternion, Vec3
from enum import Enum
import math
from scipy.optimize import minimize
import scipy.constants

from poliastro.bodies import Earth, Mars, Sun  # Or your desired bodies
from poliastro.maneuver import Maneuver
from poliastro.twobody import Orbit
import poliastro as pa
import sys
import matplotlib.pyplot as plt
import numpy as np  # For array manipulation
import os
import inspect
import time
from scipy.integrate import ode
import json
import pickle
import orbitengine.engine as oe
from orbitengine.engine import debug
from orbitengine.trajectorysegment import TrajectorySegment

class State:
    r = oe.R_ZERO
    v = oe.V_ZERO
    m = 1*u.kg
    rr = oe.ROT_R_ZERO
    rv = oe.ROT_V_ZERO
    t = 0*u.s
    temp = oe.TEMP_ZERO


class Body:
    class Type(Enum):
        PLANET = 0
        VESSEL = 1

    def __init__(self, 
                 type=Type.VESSEL,
                 name="Unamed", 
                 r0=oe.R_ZERO, 
                 v0=oe.V_ZERO, 
                 rr0=oe.ROT_R_ZERO, 
                 rv0=oe.ROT_V_ZERO, 
                 t_start=oe.T_ZERO, 
                 mass_dry=1*u.kg,
                 mass_fuel0=0*u.kg,
                 T0=oe.TEMP_ZERO,
                 parent=None, 
                 lockedPosition=False,
                 fixedScale=False):
        self.name = name
        self.k = mass_dry*(scipy.constants.G*u.m**3/u.kg/u.s**2).to(u.km**3/u.kg/u.s**2)
        self.lockedPosition = lockedPosition
        self.fixedScale = fixedScale
        self.type = type
        self.parent = parent
        self.trajectorySegments = []
        self.position = r0
        self.velocity = v0
        self.rotation = rr0
        self.w = [0,0,0]*u.rad/u.s
        self.target = None
        self.np = None
        self.velocity_np = None
        self.flag = False
        self.lastSegment = None
        self.lastTime = 0*u.s
        self.mass_fuel0 = mass_fuel0
        self.fuel_mass_flow_rate = oe.REACTION_MASS_FLOW_RATE
        self.mass_dry = mass_dry
        self.mass_cargo = 0*u.kg
        self.mass = self.total_initial_mass()
        self.tempurature = T0

        if lockedPosition:
            seg = TrajectorySegment(body=self,
                                    attractor=parent,
                                    r0=r0,
                                    v0=v0,
                                    rr0=rr0,
                                    rv0=rv0,
                                    t0=t_start,
                                    type=TrajectorySegment.Type.POSITION_LOCKED)
        elif np.linalg.norm(r0-self.parent.position) < self.parent.size + 1*u.m: # landed on that parent with 1m tolerance
            debug("Creating landed segment")
            seg = TrajectorySegment(body=self,
                                    attractor=parent,
                                    r0=r0,
                                    v0=v0,
                                    rr0=rr0,
                                    rv0=rv0,
                                    t0=t_start,
                                    m0=self.mass,
                                    type=TrajectorySegment.Type.LANDED)
        else:
            seg = TrajectorySegment(body=self,
                                    attractor=parent,
                                    r0=r0,
                                    v0=v0,
                                    rr0=rr0,
                                    rv0=rv0,
                                    t0=t_start,
                                    m0=self.mass,
                                    type=TrajectorySegment.Type.BALLISTIC)
        self.trajectorySegments.append(seg)

    def total_initial_mass(self):
        return self.mass_dry + self.mass_fuel0 + self.mass_cargo

    def setTarget(self, target):
        self.target = target

    def clearTrajectory(self):
        for seg in self.trajectorySegments:
            seg.clear()
        self.trajectorySegments = []

    def setScale(self,cameraPos):
        if self.np is None:
            return
        if self.fixedScale:
            return
        self.np.setScale(np.linalg.norm(self.position-cameraPos).to(u.km).value)

    def launch(self, t_start):
        r,v, rot, w, m, temp = self.propagate(t_start)
        thickness = 2
        color = self.color

        # compute thrust
        # normal_vec = r-self.parent.position
        # alt = np.linalg.norm(normal_vec)
        # normal_vec = normal_vec/alt
        thrust = oe.EARTH_G0*oe.SPECIFIC_IMPULSE_TYPE.Liquid * oe.REACTION_MASS_FLOW_RATE        
        accel = thrust/self.mass
        if accel <= oe.EARTH_G0:
            debug(f"Net thurst accel is {accel.to(u.m/u.s**2):.3f}.  Lift off: FAILED")
            return
        debug(f"Net thurst accel is {accel.to(u.m/u.s**2):.3f}.  Lift off: SUCCESS")
 
        #launch trajectory
        t_launch_turn = t_start + oe.LAUNCH_TURN_TIME*u.min
        seg_launch = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r,
                                v0=v,
                                t0=t_start,
                                m0=m,
                                T0=temp,
                                t1=t_launch_turn,
                                accel_func=TrajectorySegment.acc_func_launch,
                                type=TrajectorySegment.Type.LAUNCH,
                                segments=10)


        r1,v1, rot, w, m1, temp1 = seg_launch.propagate(t_launch_turn)
        seg_launch.r1 = r1
        seg_launch.v1 = v1
        seg_launch.m1 = m1
        seg_launch.T1 = temp1
        seg_launch.t1 = t_launch_turn

        # add orbit insertion trajectory
        t_insertion_stop = t_launch_turn + oe.INSERTION_BURN_TIME*u.min
        seg_insertion = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r1,
                                v0=v1,
                                m0=m1,
                                T0=temp1,
                                t0=seg_launch.t1,
                                t1=t_insertion_stop,
                                accel_func=TrajectorySegment.acc_func_orbit_insertion,
                                type=TrajectorySegment.Type.BALLISTIC,
                                segments=25)
        
        r2, v2, rot, w, m2, temp2 = seg_insertion.propagate(t_insertion_stop)
        seg_insertion.r1 = r2
        seg_insertion.v1 = v2
        seg_insertion.m1 = m2
        seg_insertion.T1 = temp2
        seg_insertion.t1 = t_insertion_stop

        # add ballistic trajectory at the end of the luanch period
        seg_ballistic = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r2,
                                v0=v2,
                                m0=m2,
                                T0=temp2,
                                t0=t_insertion_stop,
                                type=TrajectorySegment.Type.BALLISTIC)

        self.clearTrajectory()
        self.trajectorySegments.append(seg_launch)
        self.trajectorySegments.append(seg_insertion)
        self.trajectorySegments.append(seg_ballistic)
        self.printTrajectories()
        self.createTrajectoryGeometry(self.render, thickness, color)

    def printTrajectories(self):
        for seg in self.trajectorySegments:
            print(seg)


    def propagate(self, t=0*u.s, estimate=False):

        if self.flag:
            debug("----------------------------------------------")
            for seg in self.trajectorySegments:
                debug(f"{self.name} t={t.value:.2f} segment t0:{seg.t0.value:.2f} t1:{seg.t1.value:.2f} m0:{seg.m0.value:.2f} m1:{seg.m1.value:.2f} {seg.type}")

        for seg in self.trajectorySegments:
            res = seg.propagate(t, estimate=estimate)
            if res is not None:
                self.lastSegment = seg
                return res

    def update(self, time, dt, estimate=False):

        # use trajectory np data to estimate position for fast rendering
        res = self.propagate(time, estimate=estimate)
        if res is None:
            return
        
        # hide the completed segments
        for seg in self.trajectorySegments:
            if seg.t1 < time:
                seg.np.hide()

        self.position, self.velocity, self.rotation, w, self.mass, self.tempurature = res
        if self.np is None:
            return
        self.np.setPos(LVecBase3f(*self.position.to(u.km).value))
        self.np.setHpr(LVecBase3f(*self.rotation.to(u.deg).value))

        p1 = self.position.to(u.km).value
        p2 = p1 + self.velocity.to(u.km/u.s).value
#        p2 = self.position.to(u.km).value + 1000*self.velocity.to(u.km/u.s).value
        if self.velocity_np is not None:
            self.velocity_np.removeNode()
        self.velocity_np = NodePath(primatives.createLine(LVecBase3f(*p1), LVecBase3f(*p2), 2, self.color))
        self.velocity_np.reparentTo(self.render)

        self.lastTime = time

    def getHUDInfo(self):
        if self.parent is None:
            alt = 0*u.km
        else:
            alt = np.linalg.norm(self.position - self.parent.position) - self.parent.size

        text = f"{self.name}"+\
            f"  Alt: {oe.formatDistance(alt)}"+ \
            f"  Vel: {oe.formatVelocity(np.linalg.norm(self.velocity))}"
        
        if self.type == Body.Type.VESSEL:
            text += f"  Fuel: {self.mass - self.mass_dry:.2f}"
            text += f"  Temp: {self.tempurature:.2f}"
        text += '\n'

        if self.lastSegment is not None:
            if self.lastSegment != self.trajectorySegments[-1]: # last segment should be forever
                text += f"  Next Maneuver: {oe.formatTime(self.lastSegment.t1-self.lastTime)}\n"    
        if self.target is not None:
            text += f"  Target: {self.target.name}"+\
                f"  Dist:{oe.formatDistance(np.linalg.norm(self.position - self.target.position))}" + \
                f"  dV:{oe.formatVelocity(np.linalg.norm(self.velocity - self.target.velocity))}\n"
        return text

    def setDeltaV(self, dv):
        self.deltaV = dv

    def setThrust(self, thrust):
        self.thrust = thrust





    def lambertSearch(self, t_start, target, launch=False, bounds=[None, None], resolution=5, show=False):

        per1 = self.trajectorySegments[0].period
        per2 = target.trajectorySegments[0].period
        per_max = 24*u.hour # default max period in case of non-keplerian orbits
        if per1 is not None and per2 is not None:
            per_max = np.max([per1.to(u.s).value,per2.to(u.s).value])
        elif bounds[0] is None and bounds[1] is None:
            debug(f"Warning: lambertSearch using default max period of {per_max}")

        if bounds[0] is None:
            bounds[0] = t_start.to(u.s).value + per_max
        if bounds[1] is None:
            bounds[1] = per_max

        # search for the starting point
        t_start = np.linspace(t_start.to(u.s).value, bounds[0], resolution)
        t_flight = np.linspace(1800, bounds[1], resolution)

        data = np.zeros((len(t_flight), len(t_start)))
        info = [None]
        for i in range(len(t_start)):
            for j in range(len(t_flight)):
                data[i, j] = oe.compute_dv([t_start[i], t_flight[j]], self, target, info, launch)
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

    def computeInterceptManeuver2(self, t_start, target):

        solution_file = 'lambert.pkl'
        if os.path.exists(solution_file):
            with open(solution_file, 'rb') as f:
                data = pickle.load(f)
                t_transfer_start = data['t_delay']
                t_transfer_duration = data['t_flight']
                info = data['info']
        else:
            guess, min_value = self.lambertSearch(t_start, target, launch=True,resolution=50)
            debug(f"lambert guess: {guess} min_value: {min_value}")

            p1 = self.trajectorySegments[0].period.to(u.s).value
            p2 = target.trajectorySegments[0].period.to(u.s).value

            per = np.max([p1,p2])
            bounds = [(t_start.to(u.s).value, t_start.to(u.s).value + 2*per), (1,2*per)]

            info = [None]
            res = minimize(oe.compute_dv, guess, args=(self, target, info, True), bounds=bounds)
            debug(f"minimize guess: {res.x} min_value: {res.fun}")

            t_transfer_start = res.x[0]*u.s
            t_transfer_duration = res.x[1]*u.s

            # save solution to disk
            with open(solution_file, 'wb') as f:
                pickle.dump({'t_delay':t_transfer_start, 't_flight':t_transfer_duration, 'info':info}, f)


        r1, v1, r2, v2, v1_sol, v2_sol = info[0]

        dv1 = np.linalg.norm(v1 - v1_sol)
        dv2 = np.linalg.norm(v2 - v2_sol)

        thrust = oe.EARTH_G0*oe.SPECIFIC_IMPULSE_TYPE.Liquid * oe.REACTION_MASS_FLOW_RATE
        accel_max = thrust/self.mass
        t_burn1 = (dv1/accel_max).to(u.s)
        t_burn2 = (dv2/accel_max).to(u.s)

        seg = self.trajectorySegments[-1]
        seg.t1 = t_transfer_start
        seg.r1 = r1
        seg.v1 = v1

        seg_transfer = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r1,
                                v0=v1_sol,
                                t0=t_transfer_start,
                                r1=r2,
                                v1= v2_sol,
                                t1=t_transfer_start + t_transfer_duration,
                                type=TrajectorySegment.Type.BALLISTIC)
    
        seg_target = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r2,
                                v0=v2,
                                t0=t_transfer_start + t_transfer_duration,
                                type=TrajectorySegment.Type.BALLISTIC)


        # get the burn points


        t_burn1_start = t_transfer_start-t_burn1/2
        t_burn1_stop = t_transfer_start+t_burn1/2
        accel_burn1 = (v1_sol - v1)/t_burn1
        r_burn1_start, v_burn1_start, rot, w, m = seg.propagate(t_burn1_start)
        r_burn1_stop, v_burn1_stop, rot, w, m = seg_transfer.propagate(t_burn1_stop)

        t_burn2_start = t_transfer_start+t_transfer_duration-t_burn2/2
        t_burn2_stop = t_transfer_start+t_transfer_duration+t_burn2/2
        accel_burn2 = (v2-v2_sol)/t_burn2
        r_burn2_start, v_burn2_start, rot, w, m = seg_transfer.propagate(t_burn2_start)
        r_burn2_stop, v_burn2_stop, rot, w, m = seg_target.propagate(t_burn2_stop)


        #adjust end of current trajectory
        # idealized trajectories
        seg.t1 = t_burn1_start
        seg.r1 = r_burn1_start
        seg.v1 = v_burn1_start
        
        seg_burn1 = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r_burn1_start,
                                v0=v_burn1_start,
                                t0=t_burn1_start,
                                r1=r_burn1_stop,
                                v1=v_burn1_stop,
                                t1=t_burn1_stop,
                                accel=accel_burn1,
                                type=TrajectorySegment.Type.BALLISTIC)
        


        # accel aware trajectories
        seg_transfer = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r_burn1_stop,
                                v0=v_burn1_stop,
                                t0=t_burn1_stop,
                                r1=r_burn2_start,
                                v1=v_burn2_start,
                                t1=t_burn2_start,
                                type=TrajectorySegment.Type.BALLISTIC)
    


        seg_burn2 = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r_burn2_start,
                                v0=v_burn2_start,
                                t0=t_burn2_start,
                                r1=r_burn2_stop,
                                v1=v_burn2_stop,
                                t1=t_burn2_stop,
                                accel=accel_burn2,
                                type=TrajectorySegment.Type.BALLISTIC)

        seg_target = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=r_burn2_stop,
                                v0=v_burn2_stop,
                                t0=t_burn2_stop,
                                type=TrajectorySegment.Type.BALLISTIC)
 
        self.target = target
        self.trajectorySegments.append(seg_burn1)
        self.trajectorySegments.append(seg_transfer)
        self.trajectorySegments.append(seg_burn2)
        self.trajectorySegments.append(seg_target)

        for s in self.trajectorySegments:
            debug(f"{s.t0:.2f} {s.t1:.2f} {s.type}")
        self.createTrajectoryGeometry(self.render, thickness=2, color=self.color)


    def computeInterceptManeuverFromLaunch(self, t_start, orbit2):
        self.orbit.r_launch = self.position
        self.orbit.v_launch = self.velocity

        #accelation is normal to surface of attractor
        r_attractor = [0,0,0]*u.km
        acc = (self.orbit.r_launch - r_attractor)
        acc_vector = acc/np.linalg.norm(acc)
        thrust = oe.EARTH_G0*oe.SPECIFIC_IMPULSE_TYPE.Liquid * oe.REACTION_MASS_FLOW_RATE        
        self.thrust = acc_vector*thrust
        acc = self.thrust/self.mass
        t_launch = np.sqrt(2*(oe.MIMIMUM_MANEUVER_ALTITUDE/np.linalg.norm(acc)).to(u.s**2))

        v = self.orbit.v_launch + acc*t_launch
        r = self.orbit.r_launch + self.orbit.v_launch*t_launch + 0.5*acc*t_launch**2
        self.landed = False

        self.orbit.set(self.parent, r, v, t_start + t_launch)
        self.computeInterceptManeuver(t_start + t_launch, orbit2, t_launch=t_launch)

    def computeInterceptManeuver(self, t_start, orbit2, t_launch=0.0*u.s):
        if self.landed:
            self.computeInterceptManeuverFromLaunch(t_start, orbit2)
            return

        # Initial guess for the parameters
        t_flight = 1*u.s # initial guess
        t_weight = 1e-6  # let user adjust this?
        x0 = np.array([t_flight.value])
        r1, v1 = self.orbit.propagate(t_start)

        # Define the bounds for the parameters
        bounds = [(1, None)]
        ts_start = time.time()
        info = [None]
        thrust = oe.EARTH_G0*oe.SPECIFIC_IMPULSE_TYPE.Liquid * oe.REACTION_MASS_FLOW_RATE
        accel_max = thrust/self.mass

        # find trajectory assuming instant velocity change
        options = {'maxiter':35}

        result = minimize(oe.compute_totaldv, x0, args=(t_start, 0*u.m/u.s**2, self.orbit, orbit2, t_weight, info), bounds=bounds, options=options)
        t_flight = result.x[0]*u.s

        # do it again but with accel_max considered
        x0 = result.x.copy()
        result = minimize(oe.compute_totaldv, x0, args=(t_start, accel_max, self.orbit, orbit2, t_weight, info), bounds=bounds, options=options)

        t_flight = result.x[0]*u.s
        r1, v1, r2, v2, v1_sol, v2_sol, dv1, dv2 = info[0]
        t_burn1 = (dv1/accel_max).to(u.s)
        t_burn2 = (dv2/accel_max).to(u.s)

        if result.nfev == 0:
            debug(result.message)

        if t_burn1/2 + t_burn2/2 > t_flight:
            debug(f"{t_burn1/2}+{t_burn2/2} > {t_flight} - not enough thrust to execute this trajectory!!!!!!!!")
            return
        ts_stop = time.time()
#        debug(f"Trajectory optimzation Time: {ts_stop-ts_start:.2f}")
        ts_start = time.time()

        r,v = self.orbit.computePseudoManouverTrajectory(r1,v1,r2,v2,v1_sol, v2_sol,
                                                               t_flight, color=self.color, 
                                                               t_start=t_start, 
                                                               thickness=5, 
                                                               t_launch=t_launch)
        ts_stop = time.time()
 #       debug(f"PseudoManouver geometery Time: {ts_stop-ts_start:.2f}")

        if self.orbit.collision:
            debug("orbit causes collision!!!")
    
    def randomize(self, dist, vel, time=0*u.s, type=TrajectorySegment.Type.BALLISTIC, createGeometry=True):
        self.clearTrajectory()
        seg = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=self.position,
                                v0=self.velocity,
                                t0=time,
                                m0=self.total_initial_mass(),
                                type=type)
        seg.randomize(dist, vel, time=time)
        self.trajectorySegments.append(seg)
        if createGeometry:
            self.createTrajectoryGeometry(self.render, thickness=2, color=self.color)

    def createTrajectoryGeometry(self, render=None, thickness=2, color=None):
        if render is None:
            render = self.render

        if color is None:
            color = self.color

        collision = False
        for seg in self.trajectorySegments:
            collision = seg.createGeometry(render=render, thickness=thickness, color=color)

        #add final trajectory segment on planet surface
        if collision:
            self.addCollisionTrjaectory(render, thickness=thickness, color=color)

    def addCollisionTrjaectory(self, render, thickness=2, color=None):
        if color is None:
            color = self.color
        seg = self.trajectorySegments[-1]
        seg_new = TrajectorySegment(body=self,
                                attractor=self.parent,
                                r0=seg.r1,
                                v0=seg.v1,
                                m0=seg.m1,
                                rr0=seg.rr1,
                                rv0=seg.rv1,
                                t0=seg.t1,
                                type=TrajectorySegment.Type.LANDED)
        self.trajectorySegments.append(seg_new)
        seg_new.createGeometry(render=render, thickness=thickness, color=color)

    def createGeometry(self, render, type=Type.VESSEL, size=0.01*u.km, color=LVecBase4f(1,1,1,1)):
        self.color = color
        self.render = render
        self.size = size
        if type == Body.Type.VESSEL:
            self.fixedScale = False # allow scalling to camera distance
            data = primatives.createPyramid(size.to(u.km).value, color)
            self.np = NodePath(data)
        if type == Body.Type.PLANET:
            self.fixedScale = True #at some point, should convert to icon
            data = primatives.createIcosphere(size.to(u.km).value, oe.PLANET_ICOSHPERE_LEVEL, color)
            # rotate so the icosphere is aligned with the z axis
            self.np = NodePath(data)
            self.np.setRenderModeWireframe()

            #draw pole axis
            axis_data = primatives.createLine(LVecBase3f(0,0,size.to(u.km).value*0.8), 
                                              LVecBase3f(0,0,size.to(u.km).value*1.2), 2, color)
            axis_np = NodePath(axis_data)
            axis_np.reparentTo(self.np)

        self.np.reparentTo(render)

    def showTrajectory(self, show=True):
        for seg in self.trajectorySegments:
            if seg.np is not None:
                if show:
                    seg.np.show()
                else:
                    seg.np.hide()
