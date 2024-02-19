import numpy as np
import matplotlib.pyplot as plt
from scipy.constants import g
import astropy.units as u

def delta_v(Isp, m0, mf):
     return Isp*(g*u.m/u.s**2)*np.log(m0/mf)

def tank_mass(rho, wall_thickness, capacity, shape='cylinder', aspect_ratio = 0.1):
    if shape == 'cylinder':
        height = np.cbrt(capacity / (np.pi*aspect_ratio**2))
        radius = aspect_ratio * height
        surface_area = 2 * np.pi * radius * height + 2 * np.pi * radius**2
        mass = surface_area * wall_thickness * rho
        return mass
    if shape == 'sphere':
        radius = np.cbrt(3*capacity / (4*np.pi))
        surface_area = 4 * np.pi * radius**2
        mass = surface_area * wall_thickness * rho
        return mass


LOX_REACTION_RATIOS = {
    "Hydrogen": 8.15,
    "Kerosene": 2.56,
    "Methane": 3.5,
    "MetalizedHydrogen": 0.518,
}

#reaction densities
REACTION_DENSITIES = {
    "Hydrogen": 70*u.kg/u.m**3,  # kg/m^3
    "Kerosene": 810*u.kg/u.m**3,  # kg/m^3
    "Methane": 425*u.kg/u.m**3,  # kg/m^3
    "Oxygen": 1141*u.kg/u.m**3,  # kg/m^3
    "MetalizedHydrogen": 1100*u.kg/u.m**3,  # kg/m^3
    "Ammonium Perchlorate": 1825*u.kg/u.m**3,  # kg/m^3
    "HTPB": 1650*u.kg/u.m**3,  # kg/m^3
    "Uranium": 19050*u.kg/u.m**3,  # kg/m^3
}

# fuel + oxydizer mixes
REACTION_DENSITIES['Hydrogen+LOX'] = (REACTION_DENSITIES['Hydrogen'] + REACTION_DENSITIES['Oxygen']*LOX_REACTION_RATIOS['Hydrogen'])/(1+LOX_REACTION_RATIOS['Hydrogen'])    
REACTION_DENSITIES['Kerosene+LOX'] = (REACTION_DENSITIES['Kerosene'] + REACTION_DENSITIES['Oxygen']*LOX_REACTION_RATIOS['Kerosene'])/(1+LOX_REACTION_RATIOS['Kerosene'])
REACTION_DENSITIES['Methane+LOX'] = (REACTION_DENSITIES['Methane'] + REACTION_DENSITIES['Oxygen']*LOX_REACTION_RATIOS['Methane'])/(1+LOX_REACTION_RATIOS['Methane'])
REACTION_DENSITIES['MetalizedHydrogen+LOX'] = (REACTION_DENSITIES['MetalizedHydrogen'] + REACTION_DENSITIES['Oxygen']*LOX_REACTION_RATIOS['MetalizedHydrogen'])/(1+LOX_REACTION_RATIOS['MetalizedHydrogen'])
REACTION_DENSITIES['AP+HTPB'] = (REACTION_DENSITIES['Ammonium Perchlorate']*0.7 + REACTION_DENSITIES['HTPB']*0.3)


print(f"Hydrogen: {REACTION_DENSITIES['Hydrogen']:.2f}")
print(f"Oxygen: {REACTION_DENSITIES['Oxygen']:.2f}")
print(f"Hydrogen+LOX: {REACTION_DENSITIES['Hydrogen+LOX']:.2f}")

# fuel + NTP mixes
REACTION_DENSITIES['Hydrogen+NTP'] = (REACTION_DENSITIES['Hydrogen']*0.98 + REACTION_DENSITIES['Uranium']*0.02)


SPEPCIFIC_IMPULSES = {
    "AP_HTPB": 242*u.s,  # s
    "Kerosene+LOX": 320*u.s,  # s
    "Methane+LOX": 380*u.s,  # s
    "Hydrogen+LOX": 450*u.s,  # s
    "Hydrogen+NTP": 900*u.s,  # s
    "MetalizedHydrogen+LOX": 1700*u.s,  # s
}

material_density = {
    "StainlessSteel": 7930*u.kg/u.m**3,  # kg/m^3
    "Aluminum": 2700*u.kg/u.m**3,  # kg/m^3
    "CarbonComposite": 1800*u.kg/u.m**3,  # kg/m^3
    "Polymer": 1200*u.kg/u.m**3,  # kg/m^3
}

# Input values
engine_percentage = .2 # of the dry mass
falcon9_dry_mass = 25600*u.kg  # Initial mass of the rocket
falcon9_wet_mass = 544000*u.kg
falcon9_reaction_material = "Kerosene+LOX"
falcon9_fuel_mass = falcon9_wet_mass - falcon9_dry_mass
falcon9_fuel_volume = falcon9_fuel_mass / REACTION_DENSITIES[falcon9_reaction_material]
normalized_tank_mass = tank_mass(material_density["Aluminum"], 1.0*u.m, falcon9_fuel_volume)
est_thickness = (falcon9_dry_mass*(1-engine_percentage))*u.m/normalized_tank_mass
tank_thickness_est = est_thickness
tank_thickness_est = 0.02*u.m
print(f"Thickness: {tank_thickness_est:.5f}")
# Define capacity range
#capacities = np.linspace(100, 10000, 100)  # m^3

#compute capacities base on the reaction mass
reaction_material = "Hydrogen+LOX"
#reaction_material = "Kerosene+LOX"
#reaction_material = "Methane+LOX"
#reaction_material = "MetalizedHydrogen+LOX"
reaction_material = "Hydrogen+NTP"
tank_material = "Aluminum"
tank_material = "CarbonComposite"

reaction_masses = np.linspace(100000, 100000000, 500)*u.kg  # reaction mass
reaction_masses = np.linspace(10000, 10000000, 500)*u.kg  # reaction mass
#reaction_masses = np.logspace(5, 8, 100)*u.kg  # reaction mass

payload_masses = np.linspace(1, 100000, 51)*u.kg
capacities = reaction_masses / REACTION_DENSITIES[reaction_material]

# plot image of delta v given the reaction mass and payload mass
tank_masses = tank_mass(material_density[tank_material], tank_thickness_est, capacities)
rocket_masses = tank_masses/(1-engine_percentage)


DELTA_V_TARGETS = {
    "LEO (250Km)": 9400,
    "Geo Stationary": 9400+3910,
    "Lunar Land": 9400+3260+680+1730,
    "Asteroid Belt (2%-tile)": 9400+8000,
    "Mars Land": 9400+3210+1060+1440+3800,
    "Asteroid Belt (98%-tile)": 9400+14000,
}

def dv_contour_label_formater(x):
    for key, value in DELTA_V_TARGETS.items():
        if abs(x-value) < 1:
            return key
    return x


print(f"Reaction Material: {reaction_material}")
print(f"Reaction Density: {REACTION_DENSITIES[reaction_material]:.2f}")

# Calculate the delta v for each combination of payload mass and reaction mass
dv = np.empty((len(payload_masses), len(reaction_masses)))
for i, payload_mass in enumerate(payload_masses):
    for j, (reaction_mass,rocket_mass) in enumerate(zip(reaction_masses, rocket_masses)):
        initial_mass = rocket_mass + reaction_mass + payload_mass
        final_mass = rocket_mass + payload_mass        
        dv[i, j] = delta_v(SPEPCIFIC_IMPULSES[reaction_material], initial_mass, final_mass).value

# Create the image plot
#plt.imshow(dv, extent=[reaction_masses[0].value, reaction_masses[-1].value, payload_masses[0].value, payload_masses[-1]].value, origin='lower')
#plt.figure(figsize=(10, 6))
fig, ax = plt.subplots(figsize=(10, 6))
im = ax.imshow(dv, aspect='auto',cmap='jet', extent=[reaction_masses[0].value, reaction_masses[-1].value, payload_masses[0].value, payload_masses[-1].value], origin='lower')
fig.colorbar(im, ax=ax, label='Delta v')
#plt.colorbar(label='Delta v')
ax.set_xscale('log')


# Draw black contour line at dv = 7800
contours = ax.contour(reaction_masses, payload_masses, dv, levels=list(DELTA_V_TARGETS.values()),linestyles=':', colors='k')
ax.clabel(contours, inline=True, fontsize=8, fmt=dv_contour_label_formater)
plt.xlabel('Reaction Mass (kg)')
plt.ylabel('Payload Mass (kg)')
plt.show()



# plt.figure(figsize=(10, 6))
# plt.plot(capacities, tank_masses, label="Tank")
# plt.plot(capacities, rocket_mass, label="Rocket")
# plt.xlabel("Tank Capacity (m^3)")
# plt.ylabel("Mass (kg)")
# plt.title(f"Mass using {reaction_material} in Tank: {tank_material}")
# plt.grid(True)
# plt.legend()
# plt.show()

if False:
    plt.figure(figsize=(10, 6))
    for payload_mass in payload_masses:
        dv = delta_v(SPEPCIFIC_IMPULSES[reaction_material], rocket_masses+reaction_masses+payload_mass, rocket_masses+payload_mass)
        plt.plot(reaction_masses, dv, label=f"{payload_mass:.0f}")

    # for material, mass in rocket_masses.items():
    #     plt.plot(reaction_mass, mass, label=material)
    plt.xlabel("Reaction Mass (kg)")
    plt.ylabel("Delta V (m/s)")
    plt.title(f"Delta V using {reaction_material} in Tank: {tank_material}")

    # draw horizontal line at 7800
    plt.axhline(y=7800, color='r', linestyle=':', label="LEO")
    plt.axhline(y=7800+3000, color='r', linestyle='-.', label="GTO")
    plt.axhline(y=7800+4000, color='r', linestyle='--', label="Lunar")
    plt.axhline(y=7800+6500, color='r', linestyle='solid', label="Mars")

    # vertical line at 550000 kg for Falcon 9
    plt.axvline(x=550000, color='g', linestyle=':', label="Falcon 9")
    # plt.axvline(x=2880000, color='g', linestyle='-.', label="SLS")
    # plt.axvline(x=4600000, color='g', linestyle='--', label="Starship+Booster")
    # plt.axvline(x=9000000, color='g', linestyle='solid', label="SeaDragon")

    plt.grid(True)
    plt.legend()
    plt.show()