from math import pi, sin, cos

from direct.showbase.ShowBase import ShowBase
from direct.task import Task
from direct.actor.Actor import Actor
from direct.interval.IntervalGlobal import Sequence
from panda3d.core import Point3
from panda3d.core import Geom, GeomVertexFormat, GeomVertexData, GeomVertexWriter, GeomTriangles, GeomNode, CollisionRay, CollisionNode, CollisionHandlerQueue, CollisionTraverser
from panda3d.core import NodePath
import math
from panda3d.core import LineSegs, LPoint2f, LVecBase4f
import primatives

import orbitengine
import numpy as np

from direct.gui.OnscreenText import OnscreenText
from panda3d.core import TextNode


MINUTE_IN_SECONDS = 60
HOUR_IN_SECONDS = 60*MINUTE_IN_SECONDS
DAY_IN_SECONDS = 24*HOUR_IN_SECONDS
YEAR_IN_SECONDS = 365*DAY_IN_SECONDS
KILOYEAR_IN_SECONDS = 1000*YEAR_IN_SECONDS
MEGAYEAR_IN_SECONDS = 1000*KILOYEAR_IN_SECONDS
GIGAYEAR_IN_SECONDS = 1000*MEGAYEAR_IN_SECONDS
TERAYEAR_IN_SECONDS = 1000*GIGAYEAR_IN_SECONDS


def formatTime(time):
    if time > GIGAYEAR_IN_SECONDS:
        return f"{time/GIGAYEAR_IN_SECONDS:.2f} Gyr"
    if time > MEGAYEAR_IN_SECONDS:
        return f"{time/MEGAYEAR_IN_SECONDS:.2f} Myr"
    if time > KILOYEAR_IN_SECONDS:
        return f"{time/KILOYEAR_IN_SECONDS:.2f} Kyr"
    if time > YEAR_IN_SECONDS:
        return f"{time/YEAR_IN_SECONDS:.2f} yr"
    if time > DAY_IN_SECONDS:
        return f"{time/DAY_IN_SECONDS:.2f} day"
    if time > HOUR_IN_SECONDS:
        return f"{time/HOUR_IN_SECONDS:.2f} hr"
    if time > MINUTE_IN_SECONDS:
        return f"{time/MINUTE_IN_SECONDS:.2f} min"
    return f"{time:.2f} sec"


class MyApp(ShowBase):
    def __init__(self):
        ShowBase.__init__(self)

        #set background to black
        self.camLens.setFar(100000000000)
        self.setBackgroundColor(0,0,0,1)
        self.disable_mouse()

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
#        self.orbitEngine.computeLambert()

        self.ship =  orbitengine.Body("Ship",  [8000, 0, 0], [0, 9, 0], orbitengine.BodyType.VESSEL, self.render)
        self.orbitEngine.addBody(self.ship)

        self.ship2 = orbitengine.Body("Ship2", [10000, 0, 0], [0,7,0], orbitengine.BodyType.VESSEL, self.render, color=LVecBase4f(1,0,0,1))
        self.orbitEngine.addBody(self.ship2)

        axis = primatives.createAxis(orbitengine.EARTH_RADIUS_KM/2)
        axis_np = NodePath(axis)
        axis_np.reparentTo(self.render)
        
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


        # Add the spinCameraTask procedure to the task manager.
        self.taskMgr.add(self.frameUpdate, "FrameUpdate")
        self.taskMgr.add(self.cameraControl, "CameraControl")

        aspect_ratio = self.getAspectRatio()

        self.hudText = OnscreenText(text='[HUD info]', pos=(-0.95*aspect_ratio, -0.95), scale=0.04, fg=(1, 1, 1, 1), align=TextNode.ALeft)

        self.accept('mouse1', self.handleMouseLeftDown)
        self.accept('mouse1-up', self.handleMouseLeftUp)
        self.accept('mouse2', self.handleMouseMiddleDown)
        self.accept('mouse2-up', self.handleMouseMiddleUp)
        self.accept('mouse3', self.handleMouseRightDown)
        self.accept('mouse3-up', self.handleMouseRightUp)
        self.accept('wheel_up', self.handleMouseWheelUp)
        self.accept('wheel_down', self.handleMouseWheelDown)


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
        camera_info = f"{self.cameraDist:.2f}, {self.cameraRot[0]:.2f},{self.cameraRot[1]:.2f}" 

        time_multiplier = 1000
        ts = task.time*time_multiplier
        text = f"Time: {formatTime(ts)}\n"
        text += self.orbitEngine.getHUDInfo()
        self.hudText.setText(text)

        if self.hitpointPos is None:
            self.hitpoint_np.hide()
        else:
            self.hitpoint_np.setPos(self.hitpointPos)
            self.hitpoint_np.show()

        self.orbitEngine.setScale(self.camera.getPos())
        self.orbitEngine.update(task.time*time_multiplier)

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