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

import matplotlib.pyplot as plt
import numpy as np  # For array manipulation


EARTH_RADIUS_KM = const.R_earth.to(u.km).value

def formatDistance(distance):
    if distance > 9.461e+12:
        return f"{distance/9.461e+12:.2f} Lyr"
    elif distance > 1.079e+9:
        return f"{distance/1.079e+97:.2f} Lhr"
    elif distance > 299792:
        return f"{distance/299792:.2f} Lsec"
    elif distance > 1000:
        return f"{distance/1000:.2f} Mm"
    elif distance > 1:
        return f"{distance:.2f} Km"
    else:
        return f"{distance*1000:.2f} m"


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



    def update(self, time):
        for body in self.bodies:
            body.update(time)

    def setScale(self, cameraPos):
        for body in self.bodies:
            body.setScale(cameraPos)

    def getHUDInfo(self):
        info = ""
        for body in self.bodies:
            info += body.getHUDInfo() + "\n"
        return info


class BodyOrbit:
    def __init__(self, body, r0, v0, renderer, segments=100, width=2, color=LVecBase4f(1,1,1,1)):
        self.body = body
        self.color = color
        self.segments = segments


        self.orbit = Orbit.from_vectors(Earth, r0, v0)
        
        # Draw the orbit
        path = primatives.createLineList(convertToEllipse(self.orbit, self.segments), True, self.color)
        self.np = NodePath(path)
        self.np.reparentTo(renderer)

        self.periapsis = self.orbit.r_p.to(u.km).value
        self.apoapsis = self.orbit.r_a.to(u.km).value

        # Draw the periapsis and apoapsis
        if False:        

            # Calculate the eccentric anomaly E
            E = 2 * np.arctan2(np.sqrt(1-self.orbit.ecc.value) * np.sin(self.orbit.nu.value / 2), np.sqrt(1+self.orbit.ecc.value) * np.cos(self.orbit.nu.value / 2))

            # Calculate the time to periapsis
            t_periapsis = (E - self.orbit.ecc.value * np.sin(E)) / self.orbit.n.to(u.rad/u.s).value


            print(t_periapsis, self.orbit.period.value)
            # Now you can use t_periapsis as the initial time
            self.periapsis_pos,_ = self.getState(t_periapsis/self.orbit.period.value)
            self.periapsis_np = NodePath(primatives.createCube(0.005, LVecBase4f(1,0,0,1)))
            self.periapsis_np.reparentTo(renderer)
            self.periapsis_np.setPos(*self.periapsis_pos.value)

            self.apoapsis_pos,_ = self.getState(0.5)
            self.apoapsis_np = NodePath(primatives.createCube(0.005, LVecBase4f(0,0,1,1)))
            self.apoapsis_np.reparentTo(renderer)
            self.apoapsis_np.setPos(*self.apoapsis_pos.value)

    def getState(self, t):
        return self.orbit.propagate(t*self.orbit.period).rv()

        


class Body:
    def __init__(self, name, r0, v0, type, renderer, size=0.01, color=LVecBase4f(0,1,0,1)):
        self.name = name
        self.mass = 1
        self.type = type
        self.position = np.zeros((1,3))
        self.rotation = Rotation.identity()
        self.velocity = np.zeros((1,3))
        self.rotation_velocity = Rotation.identity()
        self.acceleration = np.zeros((1,3))
        self.rotation_acceleration = Rotation.identity()
        alpha = 0.25
        self.orbit = BodyOrbit(self, r0* u.km, v0* u.km / u.s, renderer,color=LVecBase4f(color[0]*alpha, color[1]*alpha, color[2]*alpha,1))

        pos, vel = self.orbit.getState(0)
        if type == BodyType.VESSEL:
            ship = primatives.createPyramid(size, color)

            self.np = NodePath(ship)
            print(ship, id(ship), id(self.np))
            self.np.reparentTo(renderer)
            self.np.setPos(LVecBase3f(*pos.value))
            self.np.setHpr(0,90,0)

        vel_line = primatives.createLine(LVecBase3f(*pos.value), LVecBase3f(*(pos.value+1000*vel.value)), 2, color)
        self.vel_line_np = NodePath(vel_line)
        self.vel_line_np.reparentTo(renderer)

    def setScale(self,cameraPos):
        self.np.setScale(np.linalg.norm(self.position-cameraPos))
        # self.orbit.apoapsis_np.setScale(np.linalg.norm(self.orbit.apoapsis_np.getPos()-cameraPos))
        # self.orbit.periapsis_np.setScale(np.linalg.norm(self.orbit.periapsis_np.getPos()-cameraPos))


    def update(self, time):
        pos, vel = self.orbit.getState((time*0.1)%1)
        self.position = pos.value
        self.velocity = vel.value
        self.np.setPos(LVecBase3f(*pos.value))

        #update the velocity vector
        vertex_data = self.vel_line_np.node().modify_geom(0).modify_vertex_data()
        vertex_writer = GeomVertexWriter(vertex_data, 'vertex')
        vertex_writer.set_row(0)
        vertex_writer.set_data3f(LVecBase3f(*self.position))        
        vertex_writer.set_row(1)
        vertex_writer.set_data3f(LVecBase3f(*(self.position+1000*self.velocity)))

    def getHUDInfo(self):
        return f"{self.name}\n"+\
            f" Alt: {formatDistance(np.linalg.norm(self.position))}\n"+ \
            f" Vel: {formatDistance(np.linalg.norm(self.velocity))}/s\n"+ \
            f" Apo: {formatDistance(self.orbit.apoapsis)}\n" + \
            f" Per: {formatDistance(self.orbit.periapsis)}\n"