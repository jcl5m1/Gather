from math import pi, sin, cos

from direct.showbase.ShowBase import ShowBase
from direct.task import Task
from direct.actor.Actor import Actor
from direct.interval.IntervalGlobal import Sequence
from panda3d.core import Point3
from panda3d.core import Geom, GeomVertexFormat, GeomVertexData, GeomVertexWriter, GeomTriangles, GeomNode
from panda3d.core import NodePath
from panda3d.core import LineSegs
from panda3d.core import GeomTriangles, GeomVertexFormat, GeomVertexData, GeomVertexWriter, GeomNode
from math import sqrt
import math
from panda3d.core import LVecBase4f
from panda3d.core import Geom, GeomVertexFormat, GeomVertexData, GeomVertexWriter, GeomTriangles, GeomNode
from panda3d.core import ColorAttrib
from panda3d.core import CardMaker, NodePath
import numpy as np
from direct.gui.OnscreenText import OnscreenText
from panda3d.core import TextNode



def normalize(vector, size=1):
    length = sqrt(vector[0] ** 2 + vector[1] ** 2 + vector[2] ** 2)/size
    return (vector[0] / length, vector[1] / length, vector[2] / length)

def midpoint(v1, v2):
    return ((v1[0] + v2[0]) / 2, (v1[1] + v2[1]) / 2, (v1[2] + v2[2]) / 2)

def createEllipse(radius_x, radius_y, num_segments, color=LVecBase4f(1, 1, 1, 1)):

    # Calculate the angle between each segment
    angle_delta = 2 * math.pi / num_segments

    # Define the vertices and colors of the ellipse
    lines = LineSegs()
    lines.setThickness(2)
    lines.moveTo(radius_x, 0, 0)
    for i in range(num_segments):
        angle = i * angle_delta
        x = radius_x * math.cos(angle)
        y = radius_y * math.sin(angle)
        lines.setColor(color)  # Red X-axis
        lines.drawTo(x, y, 0)
    lines.setColor(color)  # Red X-axis
    lines.drawTo(radius_x, 0, 0)
    return lines.create()


class Graph:
    def __init__(self, renderer, width, height, color=LVecBase4f(1, 1, 1, 1), font=None):
        # Create a CardMaker
        self.cm = CardMaker('graph')

        # Set the size of the card to create a square
        # The arguments are the left, right, bottom, and top edges of the card
        self.cm.setFrame(0, width, 0, height)

        self.width = width
        self.height = height
        #set color
        self.cm.setColor(color)

        # Create a LineSegs to hold the lines
        self.lines = LineSegs()
        self.lines.setThickness(2)
        self.lines.setColor(LVecBase4f(0.0, 1.0, 0.0, 1))

        self.lines.moveTo(0,0,0)
        self.lines.drawTo(width,0,height)

        self.lines.moveTo(0,0,height)
        self.lines.drawTo(width,0,0)

        self.np = NodePath(self.cm.generate())

        # Create a NodePath from the lines and attach it to the card
        self.lines_np = NodePath(self.lines.create())
        self.lines_np.reparentTo(self.np)
        self.lines_np.setBin("fixed", 0)

        self.vertLabels = OnscreenText(text='[info]', pos=(0.85, -0.95), scale=0.04, fg=(1, 1, 1, 1), align=TextNode.ALeft, font=font)


        self.np.reparentTo(renderer)


    def clear(self):
        for node in self.np.getChildren():
            node.removeNode()


    def plot(self, data, color=LVecBase4f(1, 1, 1, 1)):

        self.lines = LineSegs()  #clear old data?
        self.lines.setThickness(2)
        self.lines.setColor(color)
        self.data = data
        min_value = np.min(data)
        max_value = np.max(data)
        
        def scale(value, min, max):
            return (value - min) / (max - min)

        # Plot the data as lines
        self.lines.moveTo(0, 0, self.height*scale(data[0], min_value, max_value))
        for i in range(len(data)):
            self.lines.setColor(LVecBase4f(1, 1, 1, 1))  # Set color for each line segment
            self.lines.drawTo(self.width*i/len(data),0, self.height*scale(data[i], min_value, max_value))

        if self.lines_np is not None:
            self.lines_np.removeNode()

        self.vertLabels.setText(f"{min_value:.2f}")

        # Create a NodePath from the lines and attach it to the card
        self.lines_np = NodePath(self.lines.create())
        self.lines_np.reparentTo(self.np)
        self.lines_np.setBin("fixed", 0)

                
    def vline(self, i, color=LVecBase4f(1, 1, 1, 1)):
        self.lines = LineSegs()
        self.lines.setThickness(2)
        self.lines.setColor(color)
        self.lines.moveTo(self.width*i/len(self.data), 0, 0)
        self.lines.drawTo(self.width*i/len(self.data),0, self.height)
        # if self.lines_np is not None:
        #     self.lines_np.removeNode()
        # Create a NodePath from the lines and attach it to the card
        self.lines_np = NodePath(self.lines.create())
        self.lines_np.reparentTo(self.np)
        self.lines_np.setBin("fixed", 0)





def createLineList(points, close=False, color=LVecBase4f(1, 1, 1, 1)):
    # Define the vertices and colors of the ellipse
    lines = LineSegs()
    lines.setThickness(2)
    lines.moveTo(points[0][0], points[0][1], points[0][2])
    for pt in points:
        lines.setColor(color)  # Red X-axis
        lines.drawTo(pt[0], pt[1], pt[2])
    if close:
        lines.setColor(color)  # Red X-axis
        lines.drawTo(points[0][0], points[0][1], points[0][2])
    return lines.create()


def createLine(pt1, pt2, thickness=2, color=LVecBase4f(1, 1, 1, 1)):
    # Define the vertices and colors of the ellipse
    lines = LineSegs()
    lines.setThickness(thickness)
    lines.setColor(color) 
    lines.moveTo(pt1[0], pt1[1], pt1[2])
    lines.setColor(color) 
    lines.drawTo(pt2[0], pt2[1], pt2[2])
    return lines.create()


def createPyramid(size=1, color=LVecBase4f(1, 1, 1, 1)):
    format = GeomVertexFormat.getV3()
    vdata = GeomVertexData("pyramid", format, Geom.UHStatic)
    vertex_writer = GeomVertexWriter(vdata, "vertex")

    # Calculate the height based on the side length
    height = size * math.sqrt(3) / 2

    # Define the vertices
    vertices = [
        (size / 2, size / 2, -height/2),
        (-size / 2, size / 2, -height/2),
        (-size / 2, -size / 2, -height/2),
        (size / 2, -size / 2, -height/2),
        (0, 0, height/2),
    ]
    for vertex in vertices:
        vertex_writer.addData3f(*vertex)

    tris = GeomTriangles(Geom.UHStatic)

    # Define the faces (triangles)
    triangles = [
        (0, 1, 4),
        (1, 2, 4),
        (2, 3, 4),
        (3, 0, 4),
        (0, 2, 1),
        (0, 3, 2),
    ]

    for triangle in triangles:
            tris.addVertices(*triangle)

    tris.closePrimitive()

    geom = Geom(vdata)
    geom.addPrimitive(tris)

    # Create a GeomNode and attach the vertex data
    node = GeomNode("EquilateralPyramidNode")
    node.addGeom(geom)

    node.setAttrib(ColorAttrib.makeFlat(color))

    return node


def createCube(size, color=LVecBase4f(1, 1, 1, 1)):
    format = GeomVertexFormat.getV3()
    vdata = GeomVertexData("cube", format, Geom.UHStatic)
    vertex_writer = GeomVertexWriter(vdata, "vertex")

    # Define the 8 vertices of the cube
    vertices = [
        (-size, -size, -size),
        (-size, -size, size),
        (-size, size, -size),
        (-size, size, size),
        (size, -size, -size),
        (size, -size, size),
        (size, size, -size),
        (size, size, size)
    ]

    for vertex in vertices:
        vertex_writer.addData3f(*vertex)

    tris = GeomTriangles(Geom.UHStatic)

    triangles = [
        (0, 1, 2), (1, 3, 2),
        (4, 6, 5), (5, 6, 7),
        (0, 4, 1), (4, 5, 1),
        (2, 3, 6), (6, 3, 7),
        (0, 2, 4), (2, 6, 4),
        (1, 5, 3), (5, 7, 3)
    ]

    for triangle in triangles:
        tris.addVertices(*triangle)

    tris.closePrimitive()

    geom = Geom(vdata)
    geom.addPrimitive(tris)

    node = GeomNode("cube")
    node.addGeom(geom)

    node.setAttrib(ColorAttrib.makeFlat(color))

    return node


def createIcosphere(size, subdivisions):
    # Golden ratio
    phi = (1 + math.sqrt(5)) / 2

    # Create icosahedron vertices
    vertices = [
        (-1,  phi,  0),
        ( 1,  phi,  0),
        (-1, -phi,  0),
        ( 1, -phi,  0),
        ( 0, -1,  phi),
        ( 0,  1,  phi),
        ( 0, -1, -phi),
        ( 0,  1, -phi),
        ( phi,  0, -1),
        ( phi,  0,  1),
        (-phi,  0, -1),
        (-phi,  0,  1)
    ]

    faces = [
        (0, 11, 5),
        (0, 5, 1),
        (0, 1, 7),
        (0, 7, 10),
        (0, 10, 11),
        (1, 5, 9),
        (5, 11, 4),
        (11, 10, 2),
        (10, 7, 6),
        (7, 1, 8),
        (3, 9, 4),
        (3, 4, 2),
        (3, 2, 6),
        (3, 6, 8),
        (3, 8, 9),
        (4, 9, 5),
        (2, 4, 11),
        (6, 2, 10),
        (8, 6, 7),
        (9, 8, 1)
    ]


    # Subdivide the icosahedron
    if True:
        for _ in range(subdivisions):
            new_faces = []
            for face in faces:
                v1 = vertices[face[0]]
                v2 = vertices[face[1]]
                v3 = vertices[face[2]]

                # Calculate midpoints
                # m1 = normalize(midpoint(v1, v2))
                # m2 = normalize(midpoint(v2, v3))
                # m3 = normalize(midpoint(v3, v1))
                m1 = midpoint(v1, v2)
                m2 = midpoint(v2, v3)
                m3 = midpoint(v3, v1)

                # Add new vertices
                vertices.append(m1)
                vertices.append(m2)
                vertices.append(m3)

                # Add new faces
                v1_index = len(vertices) - 3
                v2_index = len(vertices) - 2
                v3_index = len(vertices) - 1

                new_faces.append((face[0], v1_index, v3_index))
                new_faces.append((v1_index, face[1], v2_index))
                new_faces.append((v2_index, face[2], v3_index))
                new_faces.append((v1_index, v2_index, v3_index))

            faces = new_faces

    # Normalize vertices
    vertices = [normalize(vertex,size) for vertex in vertices]

    # Create icosphere geometry
    format = GeomVertexFormat.getV3()
    vdata = GeomVertexData("icosphere", format, Geom.UHStatic)
    vertex_writer = GeomVertexWriter(vdata, "vertex")

    for vertex in vertices:
        vertex_writer.addData3f(*vertex)

    tris = GeomTriangles(Geom.UHStatic)

    for face in faces:
        tris.addVertices(*face)

    tris.closePrimitive()

    geom = Geom(vdata)
    geom.addPrimitive(tris)

    node = GeomNode("icosphere")
    node.addGeom(geom)

    return node


def createAxis(size):

    # Create lines for the axes
    lines = LineSegs()
    lines.setThickness(2)
    lines.setColor(1, 0, 0)  # Red X-axis
    lines.moveTo(0, 0, 0)
    lines.drawTo(size, 0, 0)
    lines.setColor(0, 1, 0)  # Green Y-axis
    lines.moveTo(0, 0, 0)
    lines.drawTo(0, size, 0)
    lines.setColor(0, 0, 1)  # Blue Z-axis
    lines.moveTo(0, 0, 0)
    lines.drawTo(0, 0, size)

    return lines.create()
