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

from direct.gui.OnscreenText import OnscreenText
from panda3d.core import TextNode


class MyApp(ShowBase):
    def __init__(self):
        ShowBase.__init__(self)

        #set background to black
        self.setBackgroundColor(0,0,0,1)
        self.disable_mouse()

        self.cameraDist = 10
        self.cameraRot = [0,0,0]
        self.cameraWheelSensitivity = 0.92
        self.mouseButtonState = [False, False, False]

        # Create a cube with size 1
        sphere = primatives.createIcosphere(1, 2)
        sphere_np = NodePath(sphere)
        sphere_np.reparentTo(self.render)
        sphere_np.setRenderModeWireframe()

        ellipse = primatives.createEllipse(2, 2, 50, color=LVecBase4f(1,0,0,1))
        ellipse_np = NodePath(ellipse)
        ellipse_np.reparentTo(self.render)

        ship = primatives.createPyramid(.1,color=LVecBase4f(0,1,0,1))
        ship_np = NodePath(ship)
        ship_np.setPos(2,0,0)
        ship_np.setHpr(0,90,0)
        ship_np.reparentTo(self.render)

        axis = primatives.createAxis(1)
        axis_np = NodePath(axis)
        axis_np.reparentTo(self.render)
        
        hitpoint = primatives.createCube(0.025,color=LVecBase4f(1,0,0,1))
        self.hitpoint_np = NodePath(hitpoint)
        self.hitpoint_np.reparentTo(self.render)
        self.hitpointPos = None
        self.hitpoint_np.hide()
        

        #close window when escape is pressed
        self.accept("escape", self.close_window)

        self.pickerRay = CollisionRay()
        self.pickerNode = CollisionNode('mouseRay')
        self.traverser = CollisionTraverser()
        self.qh = CollisionHandlerQueue()


        # Add the spinCameraTask procedure to the task manager.
        self.taskMgr.add(self.frameUpdate, "FrameUpdate")
        self.taskMgr.add(self.cameraControl, "CameraControl")

        #self.taskMgr.add(self.spinCameraTask, "SpinCameraTask")
#        self.task_mgr.add(self.rotateObject,"rotate object task")
#        self.taskMgr.add(self.handleMouseMovement, "MouseMovementTask")
        
        # aspect_ratio = self.win.getAspectRatio()
        # print('Aspect ratio:', aspect_ratio)

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

    def getAspectRatio(self, win=None):
        return super().getAspectRatio(win)

    def handleMouseWheelUp(self):
        self.cameraDist *= self.cameraWheelSensitivity
        if self.cameraDist < 2.0:
            self.cameraDist = 2.0


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
#                print('Clicked on', pickedObj)
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

        self.hudText.setPos(-0.95*aspect_ratio, -0.95)
        self.hudText.setText(f"{self.cameraDist:.2f}, {self.cameraRot[0]:.2f},{self.cameraRot[1]:.2f}")

        if self.hitpointPos is None:
            self.hitpoint_np.hide()
        else:
            self.hitpoint_np.setPos(self.hitpointPos)
            self.hitpoint_np.show()

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

#                print(f"mouse right drag {currPos} from: {self.mousePosStart}: delta {currPos-self.mousePosStart}")

        x = self.cameraDist * math.sin(self.cameraRot[0]) * math.cos(self.cameraRot[1])
        y = self.cameraDist * math.sin(self.cameraRot[0]) * math.sin(self.cameraRot[1])
        z = self.cameraDist * math.cos(self.cameraRot[0])

        self.camera.setPos(x,y,z)
        self.camera.lookAt(0, 0, 0)

        self.mouseButtonStateLast = self.mouseButtonState.copy()
        return Task.cont


#     # Define a procedure to move the camera.
#     def spinCameraTask(self, task):
#         dist = 8
#         angleDegrees = task.time * 20.0
#         angleRadians = angleDegrees * (pi / 180.0)
# #        print(dist * sin(angleRadians), -dist * cos(angleRadians), -dist * cos(angleRadians/1.3))
#         self.camera.setPos(dist * sin(angleRadians), -dist * cos(angleRadians), -dist * cos(angleRadians/1.3))
#         self.camera.setHpr(angleDegrees, 0, 0)
#         self.camera.lookAt(0, 0, 0)
#         return Task.cont


app = MyApp()
app.run()