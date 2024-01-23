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
import orbitengine as oe
import numpy as np
from poliastro.bodies import Earth
from poliastro.maneuver import Maneuver
import poliastro
import poliastro as pa
from direct.gui.OnscreenText import OnscreenText
from panda3d.core import TextNode
from poliastro.iod import vallado


FONT_FILE = "Inconsolata-Regular.ttf"
THRUST_MAG = 20.0*u.kg*u.m/u.s/u.s
WINDOW_WIDTH = 1600
WINDOW_HEIGHT = 900


epsilon = np.finfo(float).eps

def spherical_to_cartesian(r, theta, phi):
    x = r * np.sin(phi) * np.cos(theta)
    y = r * np.sin(phi) * np.sin(theta)
    z = r * np.cos(phi)
    return x, y, z

def relativeEnergy(orbit1, orbit2, t):
    r1,v1 = orbit1.propagate(t*u.s)
    r2,v2 = orbit2.propagate(t*u.s)
    dist = np.linalg.norm(r1-r2).to(u.m).value
    dv = np.linalg.norm(v1-v2).to(u.m/u.s).value
    # account for graviatonal constant?
    # mass is the same so it cancels out
    return dist+dv*dv/2,(r1,v1,r2,v2)



# find initial burn that minimizes dist+dv**2.... but hard to balance the two to get a total minimum dv
def interceptManeuverOptimization(x, orbit1, orbit2, t_simulation,optimation_history):
    vx, vy, vz, t_intercept = x
    r_alt, v_alt = orbit1.propagate(t_simulation)
    v_alt[0] += vx*u.m/u.s
    v_alt[1] += vy*u.m/u.s
    v_alt[2] += vz*u.m/u.s
    orbit_alt = oe.BodyOrbit(orbit1.body, r_alt, v_alt,time=t_simulation, render=None, segments=0)


    dv = np.linalg.norm([vx,vy,vz])
    energy, state = relativeEnergy(orbit_alt, orbit2, t_intercept) + dv*dv/2 #total energy is distance + deltaV^2 + maneuver deltaV^2

    #compute distance
    # r1,v1 = orbit_alt.propagate(t_intercept*u.s)
    # r2,v2 = orbit2.propagate(t_intercept*u.s)
    # energy = np.linalg.norm(r1-r2).to(u.m).value +dv*dv/2

    optimation_history.append([x, energy])
    return energy

# find initial burn and final burn to minimize dv
def interceptManeuverOptimization2(x, orbit1, orbit2, t_simulation,optimation_history):
    vx, vy, vz, t_intercept = x

    # find the burn time based on dv and max thrust
    dv = np.linalg.norm([vx,vy,vz])*u.m/u.s
    t_burn = (dv/(THRUST_MAG/orbit1.body.mass)).to(u.s)

    # halfway through the burn is the effective position of the object in the future on the new orbit
    # this is from the cowell propagation simulation
    r_alt, v_alt = orbit1.propagate(t_simulation+t_burn/2) 
    v_alt[0] += vx*u.m/u.s
    v_alt[1] += vy*u.m/u.s
    v_alt[2] += vz*u.m/u.s
    orbit_alt = oe.BodyOrbit(orbit1.body, r_alt, v_alt,time=t_simulation, render=None, segments=0)

    dv_initial = np.linalg.norm([vx,vy,vz])
    #do cowell propagation to get final position and velocity?
    rf, vf = orbit_alt.propagate(t_intercept*u.s)
    rt, vt = orbit2.propagate(t_intercept*u.s)

    dv_final = np.linalg.norm(vf-vt).to(u.m/u.s).value
    dist_final = np.linalg.norm(rf-rt).to(u.m).value

    # weighting the distant heavier seems to help the optimizer to find lower dv solution
    # we do need a intercept time constraint to avoid a solution that is too far in the future that is pretty close

    # low pure energy solution does not seem to yeild a physical intercept
    energy = dist_final*dist_final + dv_initial*dv_initial + dv_final*dv_final

    optimation_history.append([x, energy,rf,vf,rt,vt])
    return energy

def checkInterceptEnergy(x, orbit1, orbit2, intercept_state):
    t_intercept = x[0]
    energy, state = relativeEnergy(orbit1, orbit2, t_intercept)
    intercept_state[0] = state
    return energy


class MyApp(ShowBase):
    def __init__(self):
        ShowBase.__init__(self)

        #set background to black
        self.camLens.setFar(100000000000)
#        self.camLens.setNear(0.00001)
        self.setBackgroundColor(0,0,0,1)
        self.disable_mouse()


        self.simulationTime = 0*u.s
        self.simulationDeltaTime = 0*u.s

        # set window size
        props = WindowProperties()
        props.setSize(WINDOW_WIDTH, WINDOW_HEIGHT)
        self.win.requestProperties(props)
        aspect_ratio = WINDOW_WIDTH/WINDOW_HEIGHT

        self.cameraDist = oe.EARTH_RADIUS*15
        self.cameraDistMin = oe.EARTH_RADIUS*2
        self.cameraRot = [0,0,0]
        self.cameraWheelSensitivity = 0.92
        self.mouseButtonState = [False, False, False]

        earth = primatives.createIcosphere(oe.EARTH_RADIUS.value, 2)
        earth_np = NodePath(earth)
        earth_np.reparentTo(self.render)
        earth_np.setRenderModeWireframe()

        self.orbitEngine = oe.OrbitEngine(self.render)

        self.ship =  oe.Body("Ship",  [0,-4.0*oe.EARTH_RADIUS.to(u.km).value, 0.]*u.km, [0,0, 0]*u.km/u.s, oe.BodyType.VESSEL, self.render)
        self.ship.orbit.randomize(oe.EARTH_RADIUS*1, 0*u.km/u.s, self.simulationTime)
        self.orbitEngine.addBody(self.ship)

        self.cameraFocus = 0
        self.paused = False

        self.ship2 = oe.Body("Ship2", [10000, 0, 0]*u.km, [0,7,0]*u.km/u.s, oe.BodyType.VESSEL, self.render, color=LVecBase4f(1,0,0,1))
        self.orbitEngine.addBody(self.ship2)

        axis = primatives.createAxis(oe.EARTH_RADIUS.value/2)
        axis_np = NodePath(axis)
        axis_np.reparentTo(self.render)
        
        graph_size = (0.4,0.10*aspect_ratio)

        hitpoint = primatives.createCube(oe.EARTH_RADIUS.value*0.025,color=LVecBase4f(1,0,0,1))
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
        keys.append('space')
        keys.append('enter')
        for key in keys:
            self.keyState[key] = False
            self.accept(key, self.handleKeyDown, [key])
            self.accept(key+"-up", self.handleKeyUp, [key])
            
        self.intercept_np = None
        self.intercept2_np = None
        self.intercept = None



    def findApproximateClosestApproach(self, t_max=0):
        # #initial guess
        # x0 = [0, 0, 0, 0]

        # # Define the bounds for the parameters
        # bounds = [(0, 3600*24), (-100, 100), (-100, 100), (-100, 100)]

        MAX_ORBITS = 1

        if t_max == 0:
            t_max = self.ship.orbit.orbit.period*MAX_ORBITS
        t = np.linspace(self.simulationTime, self.simulationTime+self.ship.orbit.orbit.period*MAX_ORBITS, num=100)  # Time range from 0 to 24 hours
        energy = []
        orbit1 = self.ship.orbit
        orbit2 = self.ship2.orbit

        state = []
        for time in t:
            e, s = relativeEnergy(orbit1, orbit2, time.value)
            energy.append(e)
            state.append(s)

        # find minimum energy time
        min_energy = np.min(energy)
        min_energy_index = np.argmin(energy)
        self.min_energy_intercept_time_guess = t[min_energy_index]
        self.graph.clear()
        self.graph.plot(energy)
        self.graph.vline(min_energy_index, color=LVecBase4f(1,0,0,1))

        self.updateIntercept(*state[min_energy_index])
        

    def incrementallyFindClosestApproach(self):
        global optimation_history
        x0 = [self.min_energy_intercept_time_guess.value]
        # Define the bounds for the parameters
        bounds = [(self.simulationTime.to(u.s).value, None)]

        intercept_state = [0]
        result = minimize(checkInterceptEnergy, x0, args=(self.ship.orbit, self.ship2.orbit, intercept_state), bounds=bounds,
                          tol=1e-1, options={'maxiter':5})

        minimized_energy = result.fun
        self.min_energy_intercept_time_guess = result.x[0]*u.s
        if self.min_energy_intercept_time_guess < self.simulationTime:
            self.min_energy_intercept_time_guess = self.simulationTime
        
        self.updateIntercept(*intercept_state[0])


    def updateIntercept(self, r1, v1, r2, v2):
        # mark closest approach
        if self.intercept_np is None or self.intercept_np.is_empty():
            self.intercept = primatives.createCube(0.002,color=self.ship.color)
            self.intercept_np = NodePath(self.intercept)
            self.intercept_np.reparentTo(self.render)
        self.intercept_np.setPos(LVecBase3f(*r1.to(u.km).value))

        if self.intercept2_np is None or self.intercept2_np.is_empty():
            self.intercept2 = primatives.createCube(0.002,color=self.ship2.color)
            self.intercept2_np = NodePath(self.intercept2)
            self.intercept2_np.reparentTo(self.render)
        self.intercept2_np.setPos(LVecBase3f(*r2.to(u.km).value))

        #store the intercept data for HUD
        self.intercept = [np.linalg.norm(r1-r2), np.linalg.norm(v1-v2)]

    
    def computeInterceptManeuver(self):

        self.ship.orbit.copyNP()

        self.findApproximateClosestApproach()

        x0 = [0, 0, 0, self.min_energy_intercept_time_guess.value]

        # Define the bounds for the parameters
        bounds = [(-10000, 10000), (-10000, 10000), (-10000, 10000), (0, None)]

        optimation_history = []
        result = minimize(interceptManeuverOptimization2, x0, 
                          args=(self.ship.orbit, self.ship2.orbit, self.simulationTime, optimation_history), 
                          bounds=bounds,options={'maxiter':50})

        intercept_r1, intercept_v1, intercept_r2, intercept_v2 = optimation_history[-1][2:]
        minimized_energy = result.fun
        vx,vy,vz,t_intercept = result.x
        t_intercept = t_intercept*u.s

        # compute initial burn time
        vec_initial_burn = [vx,vy,vz]*u.m/u.s
        mag_initial_burn = np.linalg.norm(vec_initial_burn)
        vec_initial_burn = vec_initial_burn/mag_initial_burn
        t_initial_burn_duration = (mag_initial_burn/(THRUST_MAG/self.ship.mass)).to(u.s)

        # compute final burn time
        vec_final_burn = intercept_v2-intercept_v1
        mag_final_burn = np.linalg.norm(vec_final_burn)
        vec_final_burn = vec_final_burn/mag_final_burn

        # estimated final burn time to cancel expected relative velocity
        t_final_burn_duration = (mag_final_burn/(THRUST_MAG/self.ship.mass)).to(u.s)
        t_final_burn_start = (t_intercept - self.simulationTime) - t_final_burn_duration/2 - t_initial_burn_duration

        maneuvers = [
            [vec_initial_burn*THRUST_MAG/self.ship.mass, t_initial_burn_duration],
            [np.array([0,0.,0])*u.m/u.s**2,    t_final_burn_start],
            [vec_final_burn*THRUST_MAG/self.ship.mass, t_final_burn_duration],
        ]
        total_dv = 0
        total_dt = 0
        for m in maneuvers:
            total_dv += np.linalg.norm(m[0])*m[1]
            total_dt += m[1]
        
        oe.debug(f'Maneuver dv: {oe.formatVelocity(total_dv)} dt:{oe.formatTime(total_dt)}')
        # for m in maneuvers:
        #     oe.debug(f" {m[0]}\tDur:{oe.formatTime(m[1])}")
        r,v = self.ship.orbit.computeManouverTrajectory(maneuvers, color=self.ship.color, t_start=self.simulationTime, thickness=5)
        
        self.min_energy_intercept_time_guess = t_intercept + t_initial_burn_duration

        #update the intercept markers
        self.updateIntercept(intercept_r1,intercept_v1,intercept_r2,intercept_v2)
        

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
        if key == 'm':
            self.computeInterceptManeuver()
        if key == 'n':
            self.findApproximateClosestApproach()    
        if key == ']':
            self.changeCameraFocus()
        if key == 'i':
            self.computeFinalBurn()

        if key == 'x':
            self.ship.orbit.randomize(3*oe.EARTH_RADIUS, 5*u.km/u.s, self.simulationTime)
            self.ship.landed = False
            self.ship.landedPrev = False

            # clear out the other intermediate visualizations
            if self.ship.orbit.prev_np is not None:
                if not self.ship.orbit.prev_np.is_empty():
                    self.ship.orbit.prev_np.removeNode()
            if self.intercept_np is not None:
                if not self.intercept_np.is_empty():
                    self.intercept_np.removeNode()
            if self.intercept2_np is not None:
                if not self.intercept2_np.is_empty():
                    self.intercept2_np.removeNode()
            



    def changeCameraFocus(self):
        self.cameraFocus = (self.cameraFocus+1)%3


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
        

    def computeFinalBurn(self, mass, orbit, t_intercept, dv_intercept):
        #estimated final burn time to cancel expected relative velocity
        est_burntime = (np.linalg.norm(dv_intercept)/(THRUST_MAG/mass)).to(u.s)
        est_burnstart = t_intercept - est_burntime/2 - orbit.startTime

        est_burnvector = dv_intercept
        est_burnvector_mag = np.linalg.norm(est_burnvector)
        est_burnvector = est_burnvector/est_burnvector_mag

        maneuvers = [
            [np.array([0,0.,0])*u.km/u.s**2,    est_burnstart],
            [est_burnvector*THRUST_MAG/self.ship.mass, est_burntime],
        ]

        print('Maneuvers:', oe.formatTime(maneuvers[0][1]+maneuvers[1][1] ))
        for m in maneuvers:
            print(m[0], oe.formatTime(m[1]))
        r,v = orbit.computeManouverTrajectory(maneuvers, color=self.ship.color, thickness=5)



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

        thrust_vector = np.array([0.,0.,0.])
        if self.keyState.get('w', True):
            thrust_vector += np.array([0,1.,0])
        if self.keyState.get('s', True):
            thrust_vector -= np.array([0,1.,0])
        if self.keyState.get('a', True):
            thrust_vector -= np.array([1.,0,0])
        if self.keyState.get('d', True):
            thrust_vector += np.array([1.,0,0])
        if self.keyState.get('q', True):
            thrust_vector -= np.array([0,0,1.])
        if self.keyState.get('e', True):
            thrust_vector += np.array([0,0,1.])

        #target retrograde
        target_prograde = self.ship2.position-self.ship.position
        target_velocity = self.ship.velocity-self.ship2.velocity
        target_prograde_mag = np.linalg.norm(target_prograde)
        target_velocity_mag = np.linalg.norm(target_velocity)
        ortho_velocity = 0 * u.m/u.s
        if target_prograde_mag.value > epsilon and target_velocity_mag.value > epsilon:
            target_prograde_vector = np.squeeze(target_prograde/target_prograde_mag)
            target_velocity_vector = np.squeeze(target_velocity/target_velocity_mag)
            orthogonal_velocity_vector = target_velocity_vector - np.dot(target_velocity_vector, target_prograde_vector)*target_prograde_vector
            orthogonal_velocity_vector = orthogonal_velocity_vector/np.linalg.norm(orthogonal_velocity_vector)
            ortho_velocity = np.linalg.norm(target_velocity*np.dot(target_velocity_vector, orthogonal_velocity_vector))

            # cancel non-target prograde velocity
            if self.keyState.get('t', True):
                thrust_vector -= orthogonal_velocity_vector

            # retro-target velocity
            if self.keyState.get('r', True):                
                thrust_vector -= target_velocity_vector
            #target prograde
            if self.keyState.get('f', True):
                thrust_vector += target_prograde_vector

        if np.linalg.norm(thrust_vector) > epsilon:
            thrust_vector = thrust_vector/np.linalg.norm(thrust_vector)
            # thrust is applied compute updated intercept
            if self.intercept is None:
                self.findApproximateClosestApproach()
            self.incrementallyFindClosestApproach()

        thrust = THRUST_MAG*thrust_vector
        self.ship.setThrust(thrust) 

        self.orbitEngine.setScale(self.camera.getPos()*u.km)
        self.orbitEngine.update(self.simulationTime, dt)

        if self.intercept_np is not None and not self.intercept_np.is_empty():
             self.intercept_np.setScale(np.linalg.norm(self.intercept_np.getPos()-self.camera.getPos()))
        if self.intercept2_np is not None and not self.intercept2_np.is_empty():
            self.intercept2_np.setScale(np.linalg.norm(self.intercept2_np.getPos()-self.camera.getPos()))


        # hud text
        self.hudText.setPos(-0.95*aspect_ratio, 0.95)
        text = f"Time: {oe.formatTime(self.simulationTime)}"
        text += " (paused)\n" if self.paused else f" (x{self.timeMultiplier:.0e})\n"
        text += self.orbitEngine.getHUDInfo()+"\n"
        text += f"Target:\n"+\
            f"  Dist:{oe.formatDistance(np.linalg.norm(self.ship.position - self.ship2.position))}\n"+\
            f"  dV:{oe.formatVelocity(np.linalg.norm(self.ship.velocity - self.ship2.velocity))}\n"+\
            f"  orthoV:{oe.formatVelocity(ortho_velocity)}\n"
        if self.intercept is not None:
            text += f"Closest Approach:\n  {oe.formatDistance(self.intercept[0])}\n" +\
                  f"  {oe.formatVelocity(self.intercept[1])}:({oe.formatTime((self.intercept[1]/(THRUST_MAG/u.kg)))})\n"+\
                  f"  {oe.formatTime(self.min_energy_intercept_time_guess-self.simulationTime)}\n"
        self.hudText.setText(text)


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

        x = self.cameraDist.value * math.sin(self.cameraRot[0]) * math.cos(self.cameraRot[1])
        y = self.cameraDist.value * math.sin(self.cameraRot[0]) * math.sin(self.cameraRot[1])
        z = self.cameraDist.value * math.cos(self.cameraRot[0])

        if self.cameraFocus == 0:
            self.camera.setPos(x,y,z)
            self.cameraDistMin = oe.EARTH_RADIUS*1.1
            self.camera.lookAt(0, 0, 0)
        elif self.cameraFocus == 1:
            self.cameraDistMin = 10*u.m
            target_pos = self.ship.position.value
            self.camera.setPos(x+target_pos[0],y+target_pos[1],z+target_pos[2])
            self.camera.lookAt(*target_pos)
        elif self.cameraFocus == 2:
            self.cameraDistMin = 10*u.m
            target_pos = self.ship2.position.value
            self.camera.setPos(x+target_pos[0],y+target_pos[1],z+target_pos[2])
            self.camera.lookAt(*target_pos)
        
        self.mouseButtonStateLast = self.mouseButtonState.copy()
        return Task.cont



app = MyApp()
app.run()