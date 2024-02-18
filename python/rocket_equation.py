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
}

# fuel + oxydizer mixes
REACTION_DENSITIES['Hydrogen+LOX'] = (REACTION_DENSITIES['Hydrogen'] + REACTION_DENSITIES['Oxygen']*LOX_REACTION_RATIOS['Hydrogen'])/(1+LOX_REACTION_RATIOS['Hydrogen'])    
REACTION_DENSITIES['Kerosene+LOX'] = (REACTION_DENSITIES['Kerosene'] + REACTION_DENSITIES['Oxygen']*LOX_REACTION_RATIOS['Kerosene'])/(1+LOX_REACTION_RATIOS['Kerosene'])
REACTION_DENSITIES['Methane+LOX'] = (REACTION_DENSITIES['Methane'] + REACTION_DENSITIES['Oxygen']*LOX_REACTION_RATIOS['Methane'])/(1+LOX_REACTION_RATIOS['Methane'])
REACTION_DENSITIES['MetalizedHydrogen+LOX'] = (REACTION_DENSITIES['MetalizedHydrogen'] + REACTION_DENSITIES['Oxygen']*LOX_REACTION_RATIOS['MetalizedHydrogen'])/(1+LOX_REACTION_RATIOS['MetalizedHydrogen'])
REACTION_DENSITIES['AP+HTPB'] = (REACTION_DENSITIES['Ammonium Perchlorate']*0.7 + REACTION_DENSITIES['HTPB']*0.3)

SPEPCIFIC_IMPULSES = {
    "Hydrogen+LOX": 450*u.s,  # s
    "Kerosene+LOX": 320*u.s,  # s
    "Methane+LOX": 380*u.s,  # s
    "Ammonium Perchlorate": 242*u.s,  # s
    "HTPB": 242*u.s,  # s
    "MetalizedHydrogen+LOX": 1700*u.s,  # s
}

material_density = {
    "StainlessSteel": 7930*u.kg/u.m**3,  # kg/m^3
    "Aluminum": 2700*u.kg/u.m**3,  # kg/m^3
    "CarbonComposite": 1800*u.kg/u.m**3,  # kg/m^3
    "Polymer": 1200*u.kg/u.m**3,  # kg/m^3
}

# Input values
reaction_mass = np.linspace(0, 10000000, 100)*u.kg  # reaction mass
engine_percentage = .2 # of the dry mass
payload_mass = np.linspace(0.00001, 100000, 11)*u.kg
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
reaction_material = "Kerosene+LOX"
reaction_material = "Methane+LOX"
#reaction_material = "MetalizedHydrogen+LOX"
tank_material = "Aluminum"
#tank_material = "CarbonComposite"
capacities = reaction_mass / REACTION_DENSITIES[reaction_material]


print(f"Reaction Material: {reaction_material}")
print(f"Reaction Desnity: {REACTION_DENSITIES[reaction_material]:.2f}")
# for rm, capacity in zip(reaction_mass, capacities):
#     print(f"Reaction Mass: {rm:.2f}, Capacity: {capacity:.2f}")

# Calculate the mass of the tank at each capacity
# rocket_masses = {}
# for material, density in material_density.items():
#     rocket_masses[material] = tank_mass(density, tank_thickness_est, capacities)*(1+engine_percentage)
#     print(f"Rocket Dry Mass: {rocket_masses[material][-1]:.2f} using {material}")

rocket_mass = tank_mass(material_density[tank_material], tank_thickness_est, capacities)/(1-engine_percentage)

#plot the tank mass over capacity
# Plot mass vs capacity for each material
plt.figure(figsize=(10, 6))

for payload in payload_mass:
    dv = delta_v(SPEPCIFIC_IMPULSES[reaction_material], rocket_mass+reaction_mass+payload, rocket_mass+payload)
    plt.plot(reaction_mass, dv, label=f"{payload:.0f}")

# for material, mass in rocket_masses.items():
#     plt.plot(reaction_mass, mass, label=material)
plt.xlabel("Reaction Mass (kg)")
plt.ylabel("Delta V (m/s)")
plt.title(f"Delta V vs Reaction Material:{reaction_material} in Tank: {tank_material}")

# draw horizontal line at 7800
plt.axhline(y=7800, color='r', linestyle=':', label="LEO")
plt.axhline(y=7800+3000, color='r', linestyle='-.', label="GTO")
plt.axhline(y=7800+4000, color='r', linestyle='--', label="Lunar")
plt.axhline(y=7800+6500, color='r', linestyle='solid', label="Mars")
plt.grid(True)
plt.legend()
plt.show()