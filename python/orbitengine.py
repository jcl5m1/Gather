from astropy import units as u
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
import numpy as np
from astropy import constants as const
from poliastro.iod import lambert

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


EARTH_RADIUS = const.R_earth.to(u.km)

epsilon = np.finfo(float).eps

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

def convertToEllipse(orbit, segments=100):
    # Get the orbital elements
    a = orbit.a.to(u.km).value  # semi-major axis
    e = orbit.ecc.value  # eccentricity
    i = orbit.inc.to(u.rad).value  # inclination
    raan = orbit.raan.to(u.rad).value  # longitude of the ascending node
    argp = orbit.argp.to(u.rad).value  # argument of periapsis

    # Compute the semi-minor axis
    b = a * np.sqrt(1 - e**2)

    # Compute the ellipse
    theta = np.linspace(0, 2*np.pi, segments)
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
    def __init__(self, body, r0, v0, renderer, attractor=Earth, time=0*u.s,segments=100, width=2,  color=LVecBase4f(1,1,1,1)):
        self.body = body
        self.color = color
        self.renderer = renderer
        self.np = None
        self.trajectory_np = None

        self.setOrbit(attractor, r0,v0, time=time, segments=segments)

    def setOrbit(self, attractor, r0,v0, time=0*u.s, segments=100):
        self.orbit = Orbit.from_vectors(attractor, r0, v0)
        if segments > 0:
            if self.np is not None:
                self.np.removeNode()
            path = primatives.createLineList(convertToEllipse(self.orbit, segments), True, self.color)
            self.np = NodePath(path)
            self.np.reparentTo(self.renderer)
            self.periapsis = self.orbit.r_p.to(u.km)
            self.apoapsis = self.orbit.r_a.to(u.km)
        self.startTime = time


    def computeManouverTrajectory(self, maneuvers):

        pos = []
        def callback(t, y):            
            rn = y[:3]  # Position vector
            vn = y[3:]  # Velocity vector
            pos.append(rn.copy())

        #starting position and velocity
        r, v = self.orbit.rv()
        r = r.to(u.km).value
        v = v.to(u.km/u.s).value

        #for each maneuver, compute the acceleration period and then the post acceleration period
        # and concatenate the results
        for m in maneuvers:
            # Define the additional acceleration function
            def ad(t0, state, k):
                return m[0].to(u.km/u.s**2).value

            r,v = pa.twobody.propagation.cowell(
                self.orbit.attractor.k.to(u.km**3 / u.s**2).value, 
                r, 
                v,
                m[1].to(u.s).value,
                ad=ad, 
                callback=callback)

        # extrapolation 1 hour more for visualization
        def adx(t0, state, k):
            return [0,0,0]
        pa.twobody.propagation.cowell(
            self.orbit.attractor.k.to(u.km**3 / u.s**2).value, 
            r, 
            v,
            3600,
            ad=adx, 
            callback=callback)


        path = primatives.createLineList(pos, False, self.color/2)
        if self.trajectory_np is not None:
            self.trajectory_np.removeNode()
        self.trajectory_np = NodePath(path)
        self.trajectory_np.reparentTo(self.renderer)

        #final position and velocity
        return r*u.km, v*u.km/u.s

        
    def propagate(self, t=0*u.s):
        return self.orbit.propagate(t-self.startTime).rv()
    
    # def propagateWithAccel(self, t=0*u.s, accel=[0,0,0]*u.km/u.s/u.s):
    #     return self.orbit.propagate(t-self.startTime, method=pa.twobody.cowell).rv()
        
class Body:
    def __init__(self, name, r0, v0, type, renderer,attractor=Earth, size=0.01, color=LVecBase4f(0,1,0,1)):
        self.name = name
        self.mass = 1*u.kg
        self.type = type
        self.color = color
        self.thrust = [0,0,0]*u.kg*u.m/u.s/u.s
        self.deltaV = [0,0,0]*u.m/u.s
        self.position = np.zeros((1,3))*u.km
        self.rotation = Rotation.identity()
        self.velocity = np.zeros((1,3))*u.m/u.s
        self.rotation_velocity = Rotation.identity()
        self.acceleration = np.zeros((1,3))
        self.rotation_acceleration = Rotation.identity()
        alpha = 0.5
        self.orbit = BodyOrbit(self, r0* u.km, v0* u.km / u.s, 
                               renderer, attractor=attractor, 
                               color=LVecBase4f(color[0]*alpha, color[1]*alpha, color[2]*alpha,1))

        pos, vel = self.orbit.propagate()
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
        # self.orbit.apoapsis_np.setScale(np.linalg.norm(self.orbit.apoapsis_np.getPos()-cameraPos))
        # self.orbit.periapsis_np.setScale(np.linalg.norm(self.orbit.periapsis_np.getPos()-cameraPos))


    def update(self, time, dt):
        if np.linalg.norm(self.thrust.value) >= epsilon:
            pos, vel = self.orbit.propagate(time-dt)
            self.deltaV = self.thrust*dt/self.mass
            vel = vel + self.deltaV
            self.orbit.setOrbit(Earth,pos, vel, time-dt)
        pos, vel = self.orbit.propagate(time)
    
        self.position = pos
        self.velocity = vel
        self.np.setPos(LVecBase3f(*pos.value))

        #update the velocity vector
        # vertex_data = self.vel_line_np.node().modify_geom(0).modify_vertex_data()
        # vertex_writer = GeomVertexWriter(vertex_data, 'vertex')
        # vertex_writer.set_row(0)
        # vertex_writer.set_data3f(LVecBase3f(*self.position.value))        
        # vertex_writer.set_row(1)
        # vertex_writer.set_data3f(LVecBase3f(*(self.position.value+1000*self.velocity.value)))

    def getHUDInfo(self):
        return f"{self.name}\n"+\
            f" Alt: {formatDistance(np.linalg.norm(self.position))}\n"+ \
            f" Vel: {formatVelocity(np.linalg.norm(self.velocity))}\n"+ \
            f" Apo: {formatDistance(self.orbit.apoapsis)}\n" + \
            f" Per: {formatDistance(self.orbit.periapsis)}\n"
    
    def setDeltaV(self, dv):
        self.deltaV = dv

    def setThrust(self, thrust):
        self.thrust = thrust

