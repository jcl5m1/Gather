from math import pi, sin, cos
from astropy import units as u

from direct.showbase.ShowBase import ShowBase
from direct.task import Task
from direct.actor.Actor import Actor
from direct.interval.IntervalGlobal import Sequence
from matplotlib import pyplot as plt
from panda3d.core import Point3, LVecBase3f, LVecBase4f
from panda3d.core import Geom, GeomVertexFormat, GeomVertexData, GeomVertexWriter, GeomTriangles, GeomNode, CollisionRay, CollisionNode, CollisionHandlerQueue, CollisionTraverser
from panda3d.core import NodePath
import math
from panda3d.core import LineSegs, LPoint2f, LVecBase4f
from panda3d.core import WindowProperties
import primatives
import numpy as np
from scipy.optimize import minimize
from poliastro.twobody import Orbit
import orbitengine
import numpy as np
from poliastro.bodies import Earth
from poliastro.maneuver import Maneuver
import poliastro
import poliastro as pa
from direct.gui.OnscreenText import OnscreenText
from panda3d.core import TextNode
from poliastro.iod import vallado


FONT_FILE = "Inconsolata-Regular.ttf"

WINDOW_WIDTH = 1600
WINDOW_HEIGHT = 900




def relativeEnergy(orbit1, orbit2, t):
    r1,v1 = orbit1.propagate(t*u.s)
    r2,v2 = orbit2.propagate(t*u.s)
    dist = np.linalg.norm(r1-r2).value
    dv = np.linalg.norm(v1-v2).value
    return dist+dv*dv

def checkAdjustedOrbitInterceptEnergy(x, orbit1, orbit2, t_simulation):
    vx, vy, vz, t_intercept = x
    r_alt, v_alt = orbit1.propagate(0*u.s)
    v_alt[0] += vx*u.m/u.s
    v_alt[1] += vy*u.m/u.s
    v_alt[2] += vz*u.m/u.s
    orbit_alt = orbitengine.BodyOrbit(orbit1.body, r_alt, v_alt,time=t_simulation, renderer=None, segments=0)
    dv = np.linalg.norm([vx,vy,vz])
    energy = relativeEnergy(orbit_alt, orbit2, t_intercept) + dv*dv #total energy is distance + deltaV^2 + maneuver deltaV^2
#    print(x, energy)
    return energy


def checkInterceptEnergy(x, orbit1, orbit2):
    t_intercept = x[0]
    energy = relativeEnergy(orbit1, orbit2, t_intercept)
    return energy


class MyApp(ShowBase):
    def __init__(self):
        ShowBase.__init__(self)

        #set background to black
        self.camLens.setFar(100000000000)
        self.setBackgroundColor(0,0,0,1)
        self.disable_mouse()

        # set window size
        props = WindowProperties()
        props.setSize(WINDOW_WIDTH, WINDOW_HEIGHT)
        self.win.requestProperties(props)
        aspect_ratio = WINDOW_WIDTH/WINDOW_HEIGHT

        self.cameraDist = orbitengine.EARTH_RADIUS_KM*15
        self.cameraDistMin = orbitengine.EARTH_RADIUS_KM*2
        self.cameraRot = [0,0,0]
        self.cameraWheelSensitivity = 0.92
        self.mouseButtonState = [False, False, False]

        earth = primatives.createIcosphere(orbitengine.EARTH_RADIUS_KM, 2)
        earth_np = NodePath(earth)
        earth_np.reparentTo(self.render)
        earth_np.setRenderModeWireframe()

        self.orbitEngine = orbitengine.OrbitEngine(self.render)

        self.ship =  orbitengine.Body("Ship",  [-35000, -1000, 0], [0, -2, 0], orbitengine.BodyType.VESSEL, self.render)
        self.orbitEngine.addBody(self.ship)

        self.ship2 = orbitengine.Body("Ship2", [10000, 0, 0], [0,7,0], orbitengine.BodyType.VESSEL, self.render, color=LVecBase4f(1,0,0,1))
        self.orbitEngine.addBody(self.ship2)

        axis = primatives.createAxis(orbitengine.EARTH_RADIUS_KM/2)
        axis_np = NodePath(axis)
        axis_np.reparentTo(self.render)
        
        graph_size = (0.4,0.10*aspect_ratio)



        hitpoint = primatives.createCube(orbitengine.EARTH_RADIUS_KM*0.025,color=LVecBase4f(1,0,0,1))
        self.hitpoint_np = NodePath(hitpoint)
        self.hitpoint_np.reparentTo(self.render)
        self.hitpointPos = None
        self.hitpoint_np.hide()
        
        #close window when escape is pressed
        self.accept("escape", self.exit)

        self.pickerRay = CollisionRay()
        self.pickerNode = CollisionNode('mouseRay')
        self.traverser = CollisionTraverser()
        self.qh = CollisionHandlerQueue()
        self.timeMultiplier = 10
        self.simulationTime = 0

        # Add the spinCameraTask procedure to the task manager.
        self.taskMgr.add(self.frameUpdate, "FrameUpdate")
        self.taskMgr.add(self.cameraControl, "CameraControl")


        # HUD / 2D content

        font = self.loader.loadFont(FONT_FILE)
        self.hudText = OnscreenText(text='[HUD info]', pos=(-0.95*aspect_ratio, -0.95), scale=0.04, fg=(1, 1, 1, 1), align=TextNode.ALeft, font=font)


        self.graph = primatives.Graph(self.render2d, *graph_size, color=LVecBase4f(0.1,0.1,0.1,1), font=font)
        self.graph.np.setPos(0.95-graph_size[0],0.0,-0.95)


        self.accept('mouse1', self.handleMouseLeftDown)
        self.accept('mouse1-up', self.handleMouseLeftUp)
        self.accept('mouse2', self.handleMouseMiddleDown)
        self.accept('mouse2-up', self.handleMouseMiddleUp)
        self.accept('mouse3', self.handleMouseRightDown)
        self.accept('mouse3-up', self.handleMouseRightUp)
        self.accept('wheel_up', self.handleMouseWheelUp)
        self.accept('wheel_down', self.handleMouseWheelDown)

        self.lastFrameUpdateTime = 0
        self.keyState = {}
        keys=[chr(i) for i in range(32, 127)] # not the best set and should revisit

        for key in keys:
            self.keyState[key] = False
            self.accept(key, self.handleKeyDown, [key])
            self.accept(key+"-up", self.handleKeyUp, [key])
            
        self.intercept_np = None
        self.intercept2_np = None
        self.intercept = None


    def findApproximateClosestApproach(self):
        # #initial guess
        # x0 = [0, 0, 0, 0]

        # # Define the bounds for the parameters
        # bounds = [(0, 3600*24), (-100, 100), (-100, 100), (-100, 100)]

        MAX_ORBITS = 4
        t = np.linspace(self.simulationTime, self.simulationTime+self.ship.orbit.orbit.period*MAX_ORBITS, num=100)  # Time range from 0 to 24 hours
        energy = []
        orbit1 = self.ship.orbit
        orbit2 = self.ship2.orbit

        for time in t:
            energy.append(relativeEnergy(orbit1, orbit2, time.value))

        # find minimum energy time
        min_energy = np.min(energy)
        min_energy_index = np.argmin(energy)
        self.min_energy_intercept_time_guess = t[min_energy_index]
        self.graph.clear()
        self.graph.plot(energy)
        self.graph.vline(min_energy_index, color=LVecBase4f(1,0,0,1))

        self.updateIntercept()


    def incrementallyFindClosestApproach(self):

        x0 = [self.min_energy_intercept_time_guess.value]
        # Define the bounds for the parameters
#        bounds = (None, None)

        result = minimize(checkInterceptEnergy, x0, args=(self.ship.orbit, self.ship2.orbit), tol=1e-1)
        minimized_energy = result.fun
        self.min_energy_intercept_time_guess = result.x[0]*u.s
        
        self.updateIntercept()



    def updateIntercept(self):
        # mark closest approach
        if self.intercept_np is None:
            self.intercept = primatives.createCube(orbitengine.EARTH_RADIUS_KM*0.025,color=self.ship.color)
            self.intercept_np = NodePath(self.intercept)
            self.intercept_np.reparentTo(self.render)
        r1, v1 = self.ship.orbit.propagate(self.min_energy_intercept_time_guess)
        self.intercept_np.setPos(LVecBase3f(*r1.value))

        if self.intercept2_np is None:
            self.intercept2 = primatives.createCube(orbitengine.EARTH_RADIUS_KM*0.025,color=self.ship2.color)
            self.intercept2_np = NodePath(self.intercept2)
            self.intercept2_np.reparentTo(self.render)
        r2, v2 = self.ship2.orbit.propagate(self.min_energy_intercept_time_guess)
        self.intercept2_np.setPos(LVecBase3f(*r2.value))

        #store the intercept data for HUD
        self.intercept = [np.linalg.norm(r1-r2), np.linalg.norm(v1-v2)]

    
    def computeInterceptManeuver(self):

        self.findApproximateClosestApproach()

        x0 = [0, 0, 0, self.min_energy_intercept_time_guess.value]

        # Define the bounds for the parameters
        bounds = [(-1000, 1000), (-1000, 1000), (-1000, 1000), (None, None)]

        result = minimize(checkAdjustedOrbitInterceptEnergy, x0, args=(self.ship.orbit, self.ship2.orbit, self.simulationTime), bounds=bounds,tol=1e-5)

        minimized_energy = result.fun
        vx,vy,vz,t_intercept = result.x
        self.min_energy_intercept_time_guess = t_intercept*u.s
        
        #adjust orbit1
        r_alt, v_alt = self.ship.orbit.propagate()
        v_alt[0] += vx*u.m/u.s
        v_alt[1] += vy*u.m/u.s
        v_alt[2] += vz*u.m/u.s

        self.ship.orbit.setOrbit(r_alt, v_alt, time=self.simulationTime-self.simulationDeltaTime, segments=100)

        
        #print(result, minimized_energy)

        self.updateIntercept()


    def handleKeyDown(self, key):
        self.keyState[key] = True
        if key == '.':
            self.timeMultiplier *= 10
        if key == ',':
            self.timeMultiplier /= 10
            if self.timeMultiplier < 0.01:
                self.timeMultiplier = 0.01
        if key == 'm':
            self.computeInterceptManeuver()
        if key == 'n':
            self.findApproximateClosestApproach()    

    def handleKeyUp(self, key):
        self.keyState[key] = False


    def exit(self):
        self.closeWindow(self.win)
        self.userExit()

    def getAspectRatio(self, win=None):
        return super().getAspectRatio(win)

    def handleMouseWheelUp(self):
        self.cameraDist *= self.cameraWheelSensitivity
        if self.cameraDist < self.cameraDistMin:
            self.cameraDist = self.cameraDistMin


    def handleMouseWheelDown(self):
        self.cameraDist /= self.cameraWheelSensitivity
        

    def handleMouseLeftDown(self):
        # Get the mouse position
        if self.mouseWatcherNode.hasMouse():
            self.mouseButtonState[0] = True

            mpos = self.mouseWatcherNode.getMouse()

            # Set the ray's direction to the mouse position
            self.pickerRay.setFromLens(self.camNode, mpos.getX(), mpos.getY())
            self.pickerNode.addSolid(self.pickerRay)
            self.pickerNode.setFromCollideMask(GeomNode.getDefaultCollideMask())
            self.pickerNP = self.camera.attachNewNode(self.pickerNode)
            self.traverser.addCollider(self.pickerNP, self.qh)
            # Perform collision detection
            self.traverser.traverse(self.render)

            if self.qh.getNumEntries() > 0:
                # If a collision occurred, sort the entries by distance
                self.qh.sortEntries()

                # Get the closest object that was hit
                entry = self.qh.getEntry(0)
                collisionPoint = entry.getSurfacePoint(self.render)
                self.hitpointPos = collisionPoint
                pickedObj = entry.getIntoNodePath()
            else:
                self.hitpointPos = None

    def handleMouseLeftUp(self):
        if self.mouseWatcherNode.hasMouse():
            self.mouseButtonState[0] = False

    def handleMouseMiddleDown(self):
        if self.mouseWatcherNode.hasMouse():
            self.mouseButtonState[1] = True

    def handleMouseMiddleUp(self):
        if self.mouseWatcherNode.hasMouse():
            self.mouseButtonState[1] = False

    def handleMouseRightDown(self):
        if self.mouseWatcherNode.hasMouse():
            self.mouseButtonState[2] = True

    def handleMouseRightUp(self):
        if self.mouseWatcherNode.hasMouse():
            self.mouseButtonState[2] = False


    def frameUpdate(self, task):
        aspect_ratio = self.getAspectRatio()

        self.hudText.setPos(-0.95*aspect_ratio, 0.95)

        dt = (task.time - self.lastFrameUpdateTime)*self.timeMultiplier*u.s
        self.simulationDeltaTime = dt
        self.simulationTime += dt
        text = f"Time: {orbitengine.formatTime(self.simulationTime)} (x{self.timeMultiplier:.0e})\n"
        text += self.orbitEngine.getHUDInfo()+"\n"
        text += f"Target:\n  {orbitengine.formatDistance(np.linalg.norm(self.ship.position - self.ship2.position))}\n  {orbitengine.formatVelocity(np.linalg.norm(self.ship.velocity - self.ship2.velocity))}\n"
        if self.intercept is not None:
            text += f"Closest Approach:\n  {orbitengine.formatDistance(self.intercept[0])}\n  {orbitengine.formatVelocity(self.intercept[1])}\n  {orbitengine.formatTime(self.min_energy_intercept_time_guess-self.simulationTime)}\n"
        self.hudText.setText(text)

        if self.hitpointPos is None:
            self.hitpoint_np.hide()
        else:
            self.hitpoint_np.setPos(self.hitpointPos)
            self.hitpoint_np.show()

        thrustMag = 20.5*u.kg*u.m/u.s/u.s
        thrust = [0,0,0]*u.kg*u.m/u.s/u.s
        if self.keyState.get('w', True):
            thrust[1] += thrustMag
        if self.keyState.get('s', True):
            thrust[1] -= thrustMag
        if self.keyState.get('a', True):
            thrust[0] -= thrustMag
        if self.keyState.get('d', True):
            thrust[0] += thrustMag
        if self.keyState.get('q', True):
            thrust[2] -= thrustMag
        if self.keyState.get('e', True):
            thrust[2] += thrustMag

        #target retrograde
        target_prograde = self.ship2.position-self.ship.position
        target_prograde = target_prograde/np.linalg.norm(target_prograde)

        if self.keyState.get('r', True):
            thrust = -target_prograde*thrustMag
        #target prograde
        if self.keyState.get('f', True):
            thrust = target_prograde*thrustMag

        self.ship.setThrust(thrust)

        if np.linalg.norm(thrust.value) >= 0.0001:
            if self.intercept is None:
                self.findApproximateClosestApproach()
            self.incrementallyFindClosestApproach()

        self.orbitEngine.setScale(self.camera.getPos()*u.km)
        self.orbitEngine.update(self.simulationTime, dt)

        self.lastFrameUpdateTime = task.time
        return Task.cont

    def cameraControl(self, task):

        if self.mouseButtonState[2]:
            if not self.mouseButtonStateLast[2]:
                self.mousePosStart = LPoint2f(self.mouseWatcherNode.getMouse())
                self.cameraRotStart = self.cameraRot.copy()
            else:
                currPos = self.mouseWatcherNode.getMouse()
                delta = currPos - self.mousePosStart
                self.cameraRot = self.cameraRotStart.copy()
                self.cameraRot[0] += delta[1]
                self.cameraRot[1] -= delta[0]

        x = self.cameraDist * math.sin(self.cameraRot[0]) * math.cos(self.cameraRot[1])
        y = self.cameraDist * math.sin(self.cameraRot[0]) * math.sin(self.cameraRot[1])
        z = self.cameraDist * math.cos(self.cameraRot[0])

        self.camera.setPos(x,y,z)
        self.camera.lookAt(0, 0, 0)


        self.mouseButtonStateLast = self.mouseButtonState.copy()
        return Task.cont



app = MyApp()
app.run()