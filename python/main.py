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

import primatives

class MyApp(ShowBase):
    def __init__(self):
        ShowBase.__init__(self)

        self.setBackgroundColor(0,0,0,1)

        # Create a cube with size 1
        sphere = primatives.createIcosphere(2, 2)

        # Create a NodePath for the cube and attach it to the render
        sphere_np = NodePath(sphere)
        sphere_np.reparentTo(self.render)

        #set background to black

        axis = primatives.createAxis(1)
        axis_np = NodePath(axis)
        axis_np.reparentTo(self.render)
        

        #wireframe rendering
        sphere_np.setRenderModeWireframe()
        
        #close window when escape is pressed
        self.accept("escape", self.close_window)

        # Add the spinCameraTask procedure to the task manager.
        self.taskMgr.add(self.spinCameraTask, "SpinCameraTask")


    # Define a procedure to move the camera.
    def spinCameraTask(self, task):
        dist = 8
        angleDegrees = task.time * 20.0
        angleRadians = angleDegrees * (pi / 180.0)
        self.camera.setPos(dist * sin(angleRadians), -dist * cos(angleRadians), -dist * cos(angleRadians/1.3))
        self.camera.setHpr(angleDegrees, 0, 0)
        self.camera.lookAt(0, 0, 0)
        return Task.cont


app = MyApp()
app.run()