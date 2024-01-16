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

def createPyramid(size=1, color=LVecBase4f(1, 1, 1, 1)):
    format = GeomVertexFormat.getV3()
    vdata = GeomVertexData("pyramid", format, Geom.UHStatic)
    vertex_writer = GeomVertexWriter(vdata, "vertex")

    # Calculate the height based on the side length
    height = size * math.sqrt(3) / 2

    # Define the vertices
    vertices = [
        (size / 2, size / 2, 0),
        (-size / 2, size / 2, 0),
        (-size / 2, -size / 2, 0),
        (size / 2, -size / 2, 0),
        (0, 0, height),
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

    return node


def createCube(size):
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
