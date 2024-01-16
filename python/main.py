from math import pi, sin, cos

from direct.showbase.ShowBase import ShowBase
from direct.task import Task
from direct.actor.Actor import Actor
from direct.interval.IntervalGlobal import Sequence
from panda3d.core import Point3
from panda3d.core import Geom, GeomVertexFormat, GeomVertexData, GeomVertexWriter, GeomTriangles, GeomNode
from panda3d.core import NodePath
import math
from panda3d.core import LineSegs
from panda3d.core import LVecBase4f
import primatives




class MyApp(ShowBase):
    def __init__(self):
        ShowBase.__init__(self)

        #set background to black
        self.setBackgroundColor(0,0,0,1)

        # Create a cube with size 1
        sphere = primatives.createIcosphere(1, 2)
        sphere_np = NodePath(sphere)
        sphere_np.reparentTo(self.render)
        sphere_np.setRenderModeWireframe()


        ellipse = primatives.createEllipse(2, 4, 50, color=LVecBase4f(1,0,0,1))
        ellipse_np = NodePath(ellipse)
        ellipse_np.reparentTo(self.render)

        ship = primatives.createPyramid(.1,color=LVecBase4f(1,0,0,1))
        ship_np = NodePath(ship)
        ship_np.setPos(2,0,0)
        ship_np.setHpr(0,90,0)
        ship_np.reparentTo(self.render)
        ship_np.setRenderModeWireframe()

        axis = primatives.createAxis(1)
        axis_np = NodePath(axis)
        axis_np.reparentTo(self.render)
        



        #close window when escape is pressed
        self.accept("escape", self.close_window)

        # Add the spinCameraTask procedure to the task manager.
        self.taskMgr.add(self.spinCameraTask, "SpinCameraTask")
#        self.task_mgr.add(self.rotateObject,"rotate object task")


    def rotateObject(self, task):
        self.camera.setPos(0, 0,-10)
        self.camera.lookAt(0, 0, 0)

        return Task.cont

    # Define a procedure to move the camera.
    def spinCameraTask(self, task):
        dist = 8
        angleDegrees = task.time * 20.0
        angleRadians = angleDegrees * (pi / 180.0)
#        print(dist * sin(angleRadians), -dist * cos(angleRadians), -dist * cos(angleRadians/1.3))
        self.camera.setPos(dist * sin(angleRadians), -dist * cos(angleRadians), -dist * cos(angleRadians/1.3))
        self.camera.setHpr(angleDegrees, 0, 0)
        self.camera.lookAt(0, 0, 0)
        return Task.cont


app = MyApp()
app.run()