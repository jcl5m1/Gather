from astropy import units as u
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
import numpy as np
from astropy import constants as const
from poliastro.iod import lambert
from scipy.optimize import fsolve
from scipy.spatial.transform import Rotation
import primatives
from panda3d.core import LVecBase4f, NodePath, LVecBase3f,GeomVertexWriter, GeomVertexData, GeomTriangles, GeomNode
from enum import Enum
import math

from poliastro.bodies import Earth, Mars, Sun  # Or your desired bodies
from poliastro.maneuver import Maneuver
from poliastro.twobody import Orbit
import poliastro as pa

import matplotlib.pyplot as plt
import numpy as np  # For array manipulation
import os
import inspect

EARTH_RADIUS = const.R_earth.to(u.km)

epsilon = np.finfo(float).eps

def debug(msg):
    #print call stack
    stack = inspect.stack()

    #print parent function name and file and line number
    print(f"{os.path.basename(stack[1].filename)}:{stack[1].lineno} {msg}")
    

def formatTime(time):
    if time > 1*u.year:
        return f"{time.to(u.year):.2f}"
    if time > 1*u.day:
        return f"{time.to(u.day):.2f}"
    if time > 1*u.hour:
        return f"{time.to(u.hour):.2f}"
    if time > 1*u.min:
        return f"{time.to(u.min):.2f}"
    return f"{time.to(u.s):.2f}"

def formatDistance(distance):
    if distance > 9.461e+12*u.km:
        return f"{distance/9.461e+12:.2f}Lyr"
    elif distance > 1.079e+9*u.km:
        return f"{distance/1.079e+97:.2f}Lhr"
    elif distance > 299792*u.km:
        return f"{distance.to(u.lightsec):.2f}"
    elif distance > 1000*u.km:
        return f"{distance.to(u.Mm):.2f}"
    elif distance > 1*u.km:
        return f"{distance.to(u.km):.2f}"
    else:
        return f"{distance.to(u.m):.2f}"

def formatVelocity(velocity):
    if velocity > 1000*u.km/u.s:
        return f"{velocity.to(u.Mm/u.s):.2f}"
    elif velocity > 1*u.km/u.s:
        return f"{velocity.to(u.km/u.s):.2f}"
    else:
        return f"{velocity.to(u.m/u.s):.2f}"

def formatAcceleration(acceleration):
    if acceleration > 1000*u.km/u.s**2:
        return f"{acceleration.to(u.Mm/u.s**2):.2f}"
    elif acceleration > 1*u.km/u.s:
        return f"{acceleration.to(u.km/u.s**2):.2f}"
    else:
        return f"{acceleration.to(u.m/u.s**2):.2f}"

def time_to_true_anomaly(t, a, e, mu):
    # Calculate the mean anomaly
    M = t / np.sqrt(a**3 / mu)

    # Solve Kepler's equation for the eccentric anomaly
    E = fsolve(lambda E: E - e * np.sin(E) - M, M)

    # Calculate the true anomaly
    nu = 2 * np.arctan(np.sqrt((1 + e) / (1 - e)) * np.tan(E / 2))

    return nu

def convertToEllipse(orbit, segments=100, t_start=0, t_end=1):
    # Get the orbital elements
    a = orbit.a.to(u.km).value  # semi-major axis
    e = orbit.ecc.value  # eccentricity
    i = orbit.inc.to(u.rad).value  # inclination
    raan = orbit.raan.to(u.rad).value  # longitude of the ascending node
    argp = orbit.argp.to(u.rad).value  # argument of periapsis

    # Compute the semi-minor axis
    b = a * np.sqrt(1 - e**2)

    # Compute the ellipse

#    t_end *= orbit.period.to(u.s).value
#    a_start = time_to_true_anomaly(t_start, a, e, orbit.attractor.k.to(u.km**3 / u.s**2).value)
#    a_end = time_to_true_anomaly(t_end, a, e, orbit.attractor.k.to(u.km**3 / u.s**2).value)
    theta = np.linspace(2*np.pi*t_start, 2*np.pi*t_end, segments)
#    theta = np.linspace(a_start, a_end, segments)
    x = a * np.cos(theta)
    y = b * np.sin(theta)

    # Shift the ellipse to the position of the orbit's focus
    # if i > np.pi/2:
    #     x += a * e
    # else:
    x -= a * e

    # Rotate the ellipse by the argument of periapsis
    x, y = x*np.cos(argp) - y*np.sin(argp), x*np.sin(argp) + y*np.cos(argp)

    # Rotate the ellipse by the inclination
    x, z = x, y*np.sin(i)
    y = y*np.cos(i)

    # Rotate the ellipse by the longitude of the ascending node
    x, y = x*np.cos(raan) - y*np.sin(raan), x*np.sin(raan) + y*np.cos(raan)

    #create list of points from x,y,z
    points = []
    for i in range(len(x)):
        points.append([x[i],y[i],z[i]])
    
    return points

def spherical_to_cartesian(r, theta, phi):
    x = r * np.sin(theta) * np.cos(phi)
    y = r * np.sin(theta) * np.sin(phi)
    z = r * np.cos(theta)
    return x, y, z


def line_sphere_intersection(P1, P2, C, r):
    # Compute the directional vector of the line
    d = P2 - P1

    # Compute the vector from the center of the sphere to P1
    f = P1 - C

    # Solve the quadratic equation
    a = np.dot(d, d)
    b = 2 * np.dot(f, d)
    c = np.dot(f, f) - r**2

    discriminant = b**2 - 4*a*c
    if discriminant < 0:
        # No intersection
        return []
    else:
        # Compute the two intersections
        t1 = (-b - np.sqrt(discriminant)) / (2*a)
        t2 = (-b + np.sqrt(discriminant)) / (2*a)

        # If the intersections are outside the line segment, discard them
        intersections = []
        if 0 <= t1 <= 1:
            intersections.append(P1 + t1*d)
        if 0 <= t2 <= 1:
            intersections.append(P1 + t2*d)

        return intersections

class BodyType(Enum):
    PLANET = 0
    VESSEL = 1


class OrbitEngine:
    def __init__(self, renderer):
        self.bodies = []
        self.renderer = renderer

    def addBody(self, body):
        self.bodies.append(body)

    def computeLambert(self):
        pass

    def update(self, time, dt):
        for body in self.bodies:
            body.update(time, dt)

    def setScale(self, cameraPos):
        for body in self.bodies:
            body.setScale(cameraPos)

    def getHUDInfo(self):
        info = ""
        for body in self.bodies:
            info += body.getHUDInfo() + "\n"
        return info


class BodyOrbit:
    def __init__(self, body, r0, v0, render, attractor=Earth, time=0*u.s,segments=100, width=2,  color=LVecBase4f(1,1,1,1)):
        self.body = body
        self.color = color
        self.render = render
        self.np = None
        self.prev_np = None
        self.manuever_np = None
        self.collision = False
        self.collision_np = None

        self.setOrbit(attractor, r0,v0, time=time, segments=segments)

    def setOrbit(self, attractor, r0,v0, time=0*u.s, segments=100):
        self.orbit = Orbit.from_vectors(attractor, r0, v0)
        if segments > 0:
            if self.np is not None:
                self.np.removeNode()
            path = primatives.createLineList(convertToEllipse(self.orbit, segments), True, self.color)
            self.np = NodePath(path)
            self.np.reparentTo(self.render)
            self.periapsis = self.orbit.r_p.to(u.km)
            self.apoapsis = self.orbit.r_a.to(u.km)
        #the *1 breaks the reference to the simulator time, which otherwise would mean the update does not move
        self.startTime = time*1 
        
    def randomize(self, dist, vel, time=0*u.s, segments=100):

        # random 3d unit vector
        theta = np.random.uniform(0,2*np.pi)
        phi = np.random.uniform(-np.pi/2,np.pi/2)
        r = spherical_to_cartesian(dist.to(u.km).value, theta, phi)

        theta = np.random.uniform(0,2*np.pi)
        phi = np.random.uniform(-np.pi/2,np.pi/2)
        v = spherical_to_cartesian(vel.to(u.km/u.s).value, theta, phi)
        r = r*u.km
        v = v*u.km/u.s

        self.setOrbit(Earth, r, v, time=time, segments=segments)

        if self.manuever_np is not None:
            self.manuever_np.removeNode()


    def setCollionPoint(self, position):
        if self.collision_np is None or self.collision_np.is_empty():
            self.collision_np = NodePath(primatives.createCube(0.002,color=LVecBase4f(1,0,0,1)))
            self.collision_np.reparentTo(self.render)
        self.collision_np.setPos(LVecBase3f(*position))

    def clearManeuverVisualizations(self):
        if self.prev_np is not None:
            if not self.prev_np.is_empty():
                self.prev_np.removeNode()
        if self.manuever_np is not None:
            if not self.manuever_np.is_empty():
                self.manuever_np.removeNode()
        if self.collision_np is not None:
            if not self.collision_np.is_empty():
                self.collision_np.removeNode()


    def computeManouverTrajectory(self, maneuvers, color, t_start=0*u.s, thickness=5):
        pos = []
        self.collision = False
        def callback(t, state):            
            if self.collision:
                return
            rn = state[:3]  # Position vector
            vn = state[3:]  # Velocity vector
            if self.orbit.attractor.R.to(u.km).value + epsilon > np.linalg.norm(rn):
                self.collision = True
                intersections = line_sphere_intersection(pos[-1], rn, [0,0,0], self.orbit.attractor.R.to(u.km).value)
                self.setCollionPoint(intersections[0])
                pos.append(intersections[0])
                return
            pos.append(rn.copy())

        #starting position and velocity
        r, v = self.orbit.propagate(t_start - self.startTime).rv()
        r = r.to(u.km).value
        v = v.to(u.km/u.s).value

        #for each maneuver, compute the acceleration period and then the post acceleration period
        # and concatenate the results
        for m in maneuvers:
            accel, dt = m
            # Define the additional acceleration function
            def ad(t0, state, k):
                return accel.to(u.km/u.s**2).value

            r,v = pa.twobody.propagation.cowell(
                self.orbit.attractor.k.to(u.km**3 / u.s**2).value, 
                r, 
                v,
                dt.to(u.s).value,
                ad=ad, 
                callback=callback)

        if not self.collision:
            # extrapolate for 1 hour more for visualization
            pa.twobody.propagation.cowell(
                self.orbit.attractor.k.to(u.km**3 / u.s**2).value, 
                r, 
                v,
                1*3600,
                ad=None, 
                callback=callback)

        path = primatives.createLineList(pos, False, color, thickness)
        if self.manuever_np is not None:
            self.manuever_np.removeNode()
        self.manuever_np = NodePath(path)
        self.manuever_np.reparentTo(self.render)

        #final position and velocity
        return r*u.km, v*u.km/u.s

    def setScale(self,cameraPos):
        if self.collision_np is not None:
            if not self.collision_np.is_empty():
                self.collision_np.setScale(np.linalg.norm(self.collision_np.getPos()-cameraPos.to(u.km).value))

    #copy np to prev_np
    def copyNP(self):
        if self.np is not None:
            if self.prev_np is not None:
                self.prev_np.removeNode()
            self.prev_np = self.np.copyTo(self.render)
        
    def propagate(self, t=0*u.s):
        try:
            return self.orbit.propagate(t-self.startTime).rv()
        except RuntimeError as e:
            if str(e) == "Maximum number of iterations reached":
                debug(f"****************************************************************\n{e}")
                pass
            else:
                raise
        
class Body:
    def __init__(self, name, r0, v0, type, renderer,attractor=Earth, size=0.01, color=LVecBase4f(0,1,0,1)):
        self.name = name
        self.mass = 1*u.kg
        self.type = type
        self.color = color
        self.thrust_max = 0*u.kg*u.m/u.s/u.s
        self.thrust = [0,0,0]*u.kg*u.m/u.s/u.s
        self.deltaV = [0,0,0]*u.m/u.s
        self.position = np.zeros((1,3))*u.km
        self.rotation = Rotation.identity()
        self.velocity = np.zeros((1,3))*u.m/u.s
        self.rotation_velocity = Rotation.identity()
        self.acceleration = np.zeros((1,3))
        self.rotation_acceleration = Rotation.identity()
        alpha = 0.5
        self.orbit = BodyOrbit(self, r0, v0, 
                               renderer, attractor=attractor, 
                               color=LVecBase4f(color[0]*alpha, color[1]*alpha, color[2]*alpha,1))

        pos, vel = self.orbit.propagate()
        self.landed = attractor.R.to(u.km).value + epsilon > np.linalg.norm(pos.to(u.km).value)
        self.landedPrev = False

        if type == BodyType.VESSEL:
            ship = primatives.createPyramid(size, color)

            self.np = NodePath(ship)
            self.np.reparentTo(renderer)
            self.np.setPos(LVecBase3f(*pos.value))
            self.np.setHpr(0,-90,0)

        # velocity line
        # vel_line = primatives.createLine(LVecBase3f(*pos.value), LVecBase3f(*(pos.value+1000*vel.value)), 2, color)
        # self.vel_line_np = NodePath(vel_line)
        # self.vel_line_np.reparentTo(renderer)

    def setScale(self,cameraPos):
        self.np.setScale(np.linalg.norm(self.position-cameraPos).to(u.km).value)
        self.orbit.setScale(cameraPos)
        # self.orbit.apoapsis_np.setScale(np.linalg.norm(self.orbit.apoapsis_np.getPos()-cameraPos))
        # self.orbit.periapsis_np.setScale(np.linalg.norm(self.orbit.periapsis_np.getPos()-cameraPos))


    def update(self, time, dt):

        attractor = self.orbit.orbit.attractor
        if np.linalg.norm(self.thrust.value) >= epsilon:
            if self.landed: # take off
                self.orbit.setOrbit(attractor,self.position, self.velocity, time, segments=0)
            pos, vel = self.orbit.propagate(time-dt)
            self.deltaV = self.thrust*dt/self.mass
            vel = vel + self.deltaV
            self.orbit.setOrbit(attractor,pos, vel, time)
        else:
            if not self.landed: # flying
                pos, vel = self.orbit.propagate(time)
                self.position = pos.to(u.km)
                self.velocity = vel.to(u.m/u.s)
            elif not self.landedPrev:  # just landed
                pos, vel = self.orbit.propagate(time)
                #normlize pos to radius of attractor
                pos = attractor.R*pos/np.linalg.norm(pos)
                #velocity should match the surface rotation of attractor
                vel = [0,0,0]*u.m/u.s
                self.orbit.setOrbit(attractor,pos, vel, time, segments=0)
                self.position = pos.to(u.km)
                self.velocity = vel.to(u.m/u.s)

        self.np.setPos(LVecBase3f(*self.position.value))
        self.landedPrev = self.landed

        #1 meter tolerance for landing
        self.landed = attractor.R.to(u.m).value + 1 > np.linalg.norm(self.position.to(u.m).value)

        #update the velocity vector
        # vertex_data = self.vel_line_np.node().modify_geom(0).modify_vertex_data()
        # vertex_writer = GeomVertexWriter(vertex_data, 'vertex')
        # vertex_writer.set_row(0)
        # vertex_writer.set_data3f(LVecBase3f(*self.position.value))        
        # vertex_writer.set_row(1)
        # vertex_writer.set_data3f(LVecBase3f(*(self.position.value+1000*self.velocity.value)))

    def getHUDInfo(self):
        return f"{self.name}\n"+\
            f" ThrustMax: {self.thrust_max:.2f}\n"+ \
            f" Alt: {formatDistance(np.linalg.norm(self.position))}\n"+ \
            f" Vel: {formatVelocity(np.linalg.norm(self.velocity))}\n"+ \
            f" Apo: {formatDistance(self.orbit.apoapsis)}\n" + \
            f" Per: {formatDistance(self.orbit.periapsis)}\n"
    
    def setDeltaV(self, dv):
        self.deltaV = dv

    def setThrust(self, thrust):
        self.thrust = thrust

