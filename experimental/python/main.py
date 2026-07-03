from math import pi, sin, cos
from astropy import units as u
from direct.showbase.ShowBase import ShowBase
from direct.task import Task
from panda3d.core import Point3, LVecBase3f, LVecBase4f
from panda3d.core import Geom, GeomVertexFormat, GeomVertexData, GeomVertexWriter, GeomTriangles, GeomNode, CollisionRay, CollisionNode, CollisionHandlerQueue, CollisionTraverser
from panda3d.core import NodePath
import math
from panda3d.core import LineSegs, LPoint2f, LVecBase4f
from panda3d.core import WindowProperties
import primatives
import numpy as np
from scipy.optimize import minimize
import orbitengine.engine as oe
from orbitengine.engine import OrbitEngine
from orbitengine.body import Body
from orbitengine.trajectorysegment import TrajectorySegment

import numpy as np
from poliastro.bodies import Earth
import poliastro
from direct.gui.OnscreenText import OnscreenText
from panda3d.core import TextNode
import threading
from astropy.constants import M_earth
import time

FONT_FILE = "Inconsolata-Regular.ttf"
WINDOW_WIDTH = 1280
WINDOW_HEIGHT = 720
EARTH_TILT_DEG = 23.44
SHIP_SIZE = 0.01*u.km


epsilon = np.finfo(float).eps
sem = threading.Semaphore()

def random_color():
    return LVecBase4f(np.random.rand(),np.random.rand(),np.random.rand(),1)

class MyApp(ShowBase):
    def __init__(self):
        ShowBase.__init__(self)

        #set background to black
        self.camLens.setFar(100000000000)
        self.setBackgroundColor(0,0,0,1)
        self.disable_mouse()


        self.simulationTime = 0*u.s
        self.simulationDeltaTime = 0*u.s

        # set window size
        props = WindowProperties()
        props.setSize(WINDOW_WIDTH, WINDOW_HEIGHT)
        self.win.requestProperties(props)
        aspect_ratio = WINDOW_WIDTH/WINDOW_HEIGHT

        self.cameraDist = oe.EARTH_RADIUS_KM*10
        self.cameraDistMin = oe.EARTH_RADIUS_KM*2
        self.cameraRot = [1,.7,0]
        self.cameraWheelSensitivity = 0.95
        self.mouseButtonState = [False, False, False]

        self.cameraTarget = 0
        self.paused = False

        self.orbitEngine = OrbitEngine(self.render)
        rr0_earth = [0, EARTH_TILT_DEG, 0]*u.deg
        rv0_earth = [360/u.day.to(u.s), 0, 0]*u.deg/u.s
        self.planet = Body(name="Earth", 
                              type=Body.Type.PLANET,
                              rr0=rr0_earth, 
                              rv0=rv0_earth, 
                              T0=oe.TEMP_EARTH,
                              mass_dry = M_earth.to(u.kg),
                              lockedPosition=True)
        self.planet.createGeometry(type=Body.Type.PLANET, 
                                   render=self.render,size=oe.EARTH_RADIUS_KM,
                                   color=LVecBase4f(.3,.3,.3,1))
        self.orbitEngine.addBody(self.planet)

        self.ship = Body(name="Ship", 
                            type=Body.Type.VESSEL,
                            parent=self.planet,
                            r0=[1*oe.EARTH_RADIUS_KM.to(u.km).value, 0, 0]*u.km, 
                            v0=[0,0,0]*u.km/u.s,
                            T0=oe.TEMP_EARTH,
                            mass_dry=oe.FALCON9_DRY_MASS,
                            mass_fuel0=oe.FALCON9_REACTION_MASS
                            )
        self.ship.createGeometry(render=self.render,
                            type=Body.Type.VESSEL,
                            size=SHIP_SIZE,
                            color=LVecBase4f(0,1,0,1))
        self.ship.createTrajectoryGeometry(render=self.render)
        self.orbitEngine.addBody(self.ship)

        self.ship2 = Body(name="Ship2", 
                            type=Body.Type.VESSEL,
                            parent=self.planet,
                            r0=[6442.10116578,   86.01334177,   37.29261384]*u.km, 
                            v0=[-0.11445355,  7.21530347,  3.12954238]*u.km/u.s,
                               mass_dry=oe.FALCON9_DRY_MASS,
                               mass_fuel0=oe.FALCON9_REACTION_MASS)
        self.ship2.createGeometry(render=self.render,
                            type=Body.Type.VESSEL,
                            size=SHIP_SIZE,
                            color=LVecBase4f(1,0,0,1))  
        self.ship2.createTrajectoryGeometry(render=self.render)      
        self.orbitEngine.addBody(self.ship2)

        axis = primatives.createAxis(oe.EARTH_RADIUS_KM/2)
        axis_np = NodePath(axis)
        axis_np.reparentTo(self.render)
        
        graph_size = (0.4,0.10*aspect_ratio)

        hitpoint = primatives.createCube(oe.EARTH_RADIUS_KM*0.025,color=LVecBase4f(1,0,0,1))
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

        # Add the spinCameraTask procedure to the task manager.
        self.taskMgr.add(self.frameUpdate, "FrameUpdate")
        self.taskMgr.add(self.cameraControl, "CameraControl")


        # HUD / 2D content
        font = self.loader.loadFont(FONT_FILE)
        self.hudText = OnscreenText(text='[HUD info]', pos=(-0.95*aspect_ratio, -0.95), scale=0.04, fg=(1, 1, 1, 1), align=TextNode.ALeft, font=font)


        # self.graph = primatives.Graph(self.render2d, *graph_size, color=LVecBase4f(0.1,0.1,0.1,1), font=font)
        # self.graph.np.setPos(0.95-graph_size[0],0.0,-0.95)

        #UI callbacks
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
        keys.append('space')
        keys.append('enter')
        for key in keys:
            self.keyState[key] = False
            self.accept(key, self.handleKeyDown, [key])
            self.accept(key+"-up", self.handleKeyUp, [key])
            
        self.intercept_np = None
        self.intercept2_np = None
        self.intercept = None

    def handleKeyDown(self, key):

        self.keyState[key] = True
        if key == 'space':
            self.paused = not self.paused
        if key == 'enter':
            print("enter")

        if key == '.':
            self.timeMultiplier *= 10
        if key == ',':
            self.timeMultiplier /= 10
            if self.timeMultiplier < 0.001:
                self.timeMultiplier = 0.001
        # if key == 'm':
        #     self.ship.computeInterceptManeuver2(self.simulationTime, self.ship2)
        if key == '-':
            self.ship.thrust_max /= 1.1
            if self.ship.thrust_max < 0.1*u.kg*u.m/u.s/u.s:
                self.ship.thrust_max = 0.1*u.kg*u.m/u.s/u.s
        if key == 'l':
            self.ship.launch(self.simulationTime)
        if key == 'b':
            self.ship.flag = True
        if key == '=':
            self.ship.thrust_max *= 1.1
        if key == ']':
            self.changeCameraTarget(1)
        if key == '[':
            self.changeCameraTarget(-1)
        if key == 'x':
            self.ship.randomize(1*oe.EARTH_RADIUS_KM, 0*u.km/u.s, self.simulationTime, type=TrajectorySegment.Type.LANDED)
        if key == 'n':
            oe.print("adding ship")
            thread = threading.Thread(target=self.addRandomShip)
            thread.start()

    def addRandomShip(self):
        new_ship = Body(name=f"Ship-{self.orbitEngine.bodyCount()}",
                            type=Body.Type.VESSEL,
                            parent=self.planet,
                            mass_dry=oe.FALCON9_DRY_MASS,
                            mass_fuel0=oe.FALCON9_REACTION_MASS
                            )
        new_ship.createGeometry(render=self.render,
                                type=Body.Type.VESSEL,
                                size=SHIP_SIZE,
                                color=random_color())
        new_ship.randomize(1*oe.EARTH_RADIUS_KM, 
                           0*u.km/u.s, 
                           self.simulationTime, 
                           type=TrajectorySegment.Type.LANDED,
                           createGeometry=False)
        new_ship.launch(self.simulationTime)
        self.orbitEngine.addBody(new_ship)


    def changeCameraTarget(self,step=1):
        self.cameraTarget = (self.cameraTarget+step)%len(self.orbitEngine.bodies)

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

        dt = (task.time - self.lastFrameUpdateTime)*self.timeMultiplier*u.s
        if self.paused:
            dt = 0*u.s
        self.simulationDeltaTime = dt
        self.simulationTime += dt

        aspect_ratio = self.getAspectRatio()


        if self.hitpointPos is None:
            self.hitpoint_np.hide()
        else:
            self.hitpoint_np.setPos(self.hitpointPos)
            self.hitpoint_np.show()

        self.orbitEngine.setScale(self.camera.getPos()*u.km)
        self.orbitEngine.update(self.simulationTime, dt, self.cameraTarget)

        if self.intercept_np is not None and not self.intercept_np.is_empty():
             self.intercept_np.setScale(np.linalg.norm(self.intercept_np.getPos()-self.camera.getPos()))
        if self.intercept2_np is not None and not self.intercept2_np.is_empty():
            self.intercept2_np.setScale(np.linalg.norm(self.intercept2_np.getPos()-self.camera.getPos()))

        # hud text
        self.hudText.setPos(-0.95*aspect_ratio, 0.95)
        text = f"Time: {oe.formatTime(self.simulationTime)}"
        text += " (paused)\n" if self.paused else f" (x{self.timeMultiplier:.0e})\n"
        text += self.orbitEngine.bodies[self.cameraTarget].getHUDInfo()+"\n"
#        text += self.orbitEngine.getHUDInfo()+"\n"

        self.hudText.setText(text)

        # test interval
        if False:
            TEST_INTERVAL = 2
            if task.time%TEST_INTERVAL > TEST_INTERVAL/2 and self.lastFrameUpdateTime%TEST_INTERVAL < TEST_INTERVAL/2:
                thread = threading.Thread(target=self.handleKeyDown, args=('x'))
                thread.start()
            
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

        # slow autorotation
        #self.cameraRot[1] += 0.005

        x = self.cameraDist.value * math.sin(self.cameraRot[0]) * math.cos(self.cameraRot[1])
        y = self.cameraDist.value * math.sin(self.cameraRot[0]) * math.sin(self.cameraRot[1])
        z = self.cameraDist.value * math.cos(self.cameraRot[0])

        target = self.orbitEngine.bodies[self.cameraTarget]

        if self.cameraTarget == 0:
            self.cameraDistMin = oe.EARTH_RADIUS_KM*1.1
        else:
            self.cameraDistMin = 10*u.m

        for i in range(len(self.orbitEngine.bodies)):
            self.orbitEngine.bodies[i].showTrajectory(i==self.cameraTarget)

        target_pos = target.position.value
        self.camera.setPos(x+target_pos[0],y+target_pos[1],z+target_pos[2])
        self.camera.lookAt(*target_pos)

        self.mouseButtonStateLast = self.mouseButtonState.copy()
        return Task.cont

#print(dir(oe))
#print(oe.engine.EARTH_RADIUS)

#oe.plot_rocket_lift()

app = MyApp()
app.run()