import requests
import json

# Example using JSONPlaceholder - a free fake REST API service
api_url = "https://script.google.com/macros/s/AKfycbye1_rA5ABQDZdH2e1T3a8ZrAie4FOYKaiOmQajmfmIANUs8Tkq0urfedER8nIIRcTN-Q/exec"


def post(url, payload):
    try:
        # Send POST request to create item
        response = requests.post(url, json=payload)
        
        # Check if request was successful
        if response.status_code == 200:  #Appscript cannot return 201
            print("Item created successfully!")
            print("Response:", json.dumps(response.json(), indent=2))
            return response.json()
        else:
            print(f"Failed to create item. Status code: {response.status_code}")
            print("Response:", response.text)
            return None
            
    except requests.exceptions.RequestException as e:
        print(f"An error occurred: {e}")
        return None
    

def get(url, payload):
    try:
        # Send GET request with parameters as query string
        response = requests.get(url, params=payload)
        
        # Check if request was successful
        if response.status_code == 200:
            print("Item retrieved successfully!")
            print("Response:", response.text)
            return response.json()
        else:
            print(f"Failed to retrieve item. Status code: {response.status_code}")
            print("Response:", response.text)
            return None
            
    except requests.exceptions.RequestException as e:
        print(f"An error occurred: {e}")
        return None

if __name__ == "__main__":
    # Execute the create operation
        # Data to be sent to create a new item
    payload = {
        "operation": "create",
        "table": "bodies",
        "data" : {
            "name":"Saturn",
            "mass": 60,
        }
    }
    # payload = {
    #     "operation": "read",
    #     "table": "bodies",
    #     "id": 4
    # }

    data = [
        {
            "name": "Aluminum",
            "density_kg_m3": 2700,
            "cost_usd_per_kg": 2.1
        },
        {
            "name": "Steel",
            "density_kg_m3": 7850,
            "cost_usd_per_kg": 2.5
        },
        {
            "name": "Copper",
            "density_kg_m3": 8960,
            "cost_usd_per_kg": 9.5
        },
        {
            "name": "Titanium",
            "density_kg_m3": 4507,
            "cost_usd_per_kg": 22.0
        },
        {
            "name": "Nylon",
            "density_kg_m3": 1140,
            "cost_usd_per_kg": 3.0
        },
        {
            "name": "Polyester",
            "density_kg_m3": 1335,
            "cost_usd_per_kg": 2.8
        },
        {
            "name": "Fiberglass",
            "density_kg_m3": 1900,
            "cost_usd_per_kg": 4.5
        },
        {
            "name": "Carbon Fiber",
            "density_kg_m3": 1750,
            "cost_usd_per_kg": 20.0
        },
        {
            "name": "Tungsten",
            "density_kg_m3": 19250,
            "cost_usd_per_kg": 48.0
        },
        {
            "name": "Nickel",
            "density_kg_m3": 8908,
            "cost_usd_per_kg": 26.0
        },
        {
            "name": "Brass",
            "density_kg_m3": 8500,
            "cost_usd_per_kg": 7.0
        },
        {
            "name": "Bronze",
            "density_kg_m3": 8800,
            "cost_usd_per_kg": 6.5
        },
        {
            "name": "Stainless Steel",
            "density_kg_m3": 7900,
            "cost_usd_per_kg": 2.8
        },
        {
            "name": "Magnesium",
            "density_kg_m3": 1740,
            "cost_usd_per_kg": 3.5
        },
        {
            "name": "Aluminum Alloy (6061)",
            "density_kg_m3": 2680,
            "cost_usd_per_kg": 2.3
        },
        {
            "name": "Copper Alloy",
            "density_kg_m3": 8940,
            "cost_usd_per_kg": 10.0
        },
        {
            "name": "Titanium Alloy",
            "density_kg_m3": 4430,
            "cost_usd_per_kg": 25.0
        },
        {
            "name": "Polypropylene",
            "density_kg_m3": 900,
            "cost_usd_per_kg": 1.5
        },
        {
            "name": "Polystyrene",
            "density_kg_m3": 1040,
            "cost_usd_per_kg": 2.0
        },
        {
            "name": "Acrylic (PMMA)",
            "density_kg_m3": 1190,
            "cost_usd_per_kg": 2.5
        },
        {
            "name": "Nitrile Butadiene Rubber (NBR)",
            "density_kg_m3": 1150,
            "cost_usd_per_kg": 4.0
        },
        {
            "name": "Polyurethane",
            "density_kg_m3": 1100,
            "cost_usd_per_kg": 2.8
        },
        {
            "name": "Silicone Rubber",
            "density_kg_m3": 1000,
            "cost_usd_per_kg": 5.0
        },
        {
            "name": "Epoxy Resin",
            "density_kg_m3": 1130,
            "cost_usd_per_kg": 4.5
        },
        {
            "name": "Vinyl Chloride (PVC)",
            "density_kg_m3": 1380,
            "cost_usd_per_kg": 1.7
        },
        {
            "name": "ABS Plastic",
            "density_kg_m3": 1020,
            "cost_usd_per_kg": 2.2
        },
        {
            "name": "Polycarbonate (PC)",
            "density_kg_m3": 1200,
            "cost_usd_per_kg": 4.0
        },
        {
            "name": "Nylon 6",
            "density_kg_m3": 1140,
            "cost_usd_per_kg": 3.0
        },
        {
            "name": "Polyethylene Terephthalate (PET)",
            "density_kg_m3": 1380,
            "cost_usd_per_kg": 1.6
        },
        {
            "name": "High-Density Polyethylene (HDPE)",
            "density_kg_m3": 950,
            "cost_usd_per_kg": 1.4
        },
        {
            "name": "Low-Density Polyethylene (LDPE)",
            "density_kg_m3": 920,
            "cost_usd_per_kg": 1.3
        },
        {
            "name": "Polyvinylidene Fluoride (PVDF)",
            "density_kg_m3": 1780,
            "cost_usd_per_kg": 45.0
        },
        {
            "name": "Fiberglass Reinforced Plastic",
            "density_kg_m3": 2000,
            "cost_usd_per_kg": 6.0
        },
        {
            "name": "Carbon Fiber Reinforced Polymer (CFRP)",
            "density_kg_m3": 1750,
            "cost_usd_per_kg": 40.0
        },
        {
            "name": "Aluminum Foam",
            "density_kg_m3": 200,
            "cost_usd_per_kg": 15.0
        },
        {
            "name": "Honeycomb Aluminum",
            "density_kg_m3": 400,
            "cost_usd_per_kg": 18.0
        },
        {
            "name": "Phenolic Resin",
            "density_kg_m3": 1250,
            "cost_usd_per_kg": 5.0
        },
        {
            "name": "Melamine Formaldehyde (MF)",
            "density_kg_m3": 1300,
            "cost_usd_per_kg": 4.5
        },
        {
            "name": "Urea Formaldehyde (UF)",
            "density_kg_m3": 1280,
            "cost_usd_per_kg": 3.5
        },
        {
            "name": "Thermoplastic Elastomer (TPE)",
            "density_kg_m3": 950,
            "cost_usd_per_kg": 3.0
        },
        {
            "name": "Thermoplastic Polyurethane (TPU)",
            "density_kg_m3": 1080,
            "cost_usd_per_kg": 4.0
        },
        {
            "name": "Acetal (POM)",
            "density_kg_m3": 1420,
            "cost_usd_per_kg": 5.0
        },
        {
            "name": "Polyamide-imide (PAI)",
            "density_kg_m3": 1360,
            "cost_usd_per_kg": 55.0
        },
        {
            "name": "Polyetherimide (PEI)",
            "density_kg_m3": 1280,
            "cost_usd_per_kg": 45.0
        },
        {
            "name": "Polysulfone (PSU)",
            "density_kg_m3": 1260,
            "cost_usd_per_kg": 50.0
        },
        {
            "name": "Polyphenylene Sulfide (PPS)",
            "density_kg_m3": 1350,
            "cost_usd_per_kg": 42.0
        },
        {
            "name": "Polyetherketone (PEK)",
            "density_kg_m3": 1280,
            "cost_usd_per_kg": 48.0
        },
        {
            "name": "Polyphenylene Oxide (PPO)",
            "density_kg_m3": 1260,
            "cost_usd_per_kg": 40.0
        },
        {
            "name": "Liquid Crystal Polymer (LCP)",
            "density_kg_m3": 1350,
            "cost_usd_per_kg": 55.0
        },
        {
            "name": "Polyarylate (PAR)",
            "density_kg_m3": 1290,
            "cost_usd_per_kg": 48.0
        },
        {
            "name": "Polybenzimidazole (PBI)",
            "density_kg_m3": 1300,
            "cost_usd_per_kg": 50.0
        },
        {
            "name": "Metal Matrix Composite",
            "density_kg_m3": 2800,
            "cost_usd_per_kg": 60.0
        },
        {
            "name": "Ceramic Matrix Composite",
            "density_kg_m3": 2500,
            "cost_usd_per_kg": 70.0
        },
        {
            "name": "Titanium Alloy",
            "density_kg_m3": 4500,
            "cost_usd_per_kg": 180.0
        },
        {
            "name": "Inconel Alloy",
            "density_kg_m3": 8000,
            "cost_usd_per_kg": 250.0
        },
        {
            "name": "Stainless Steel",
            "density_kg_m3": 7900,
            "cost_usd_per_kg": 2.5
        },
        {
            "name": "Aluminum Alloy",
            "density_kg_m3": 2700,
            "cost_usd_per_kg": 2.0
        },
        {
            "name": "Copper",
            "density_kg_m3": 8960,
            "cost_usd_per_kg": 4.5
        },
        {
            "name": "Brass",
            "density_kg_m3": 8700,
            "cost_usd_per_kg": 3.0
        },
        {
            "name": "Bronze",
            "density_kg_m3": 8800,
            "cost_usd_per_kg": 4.0
        },
        {
            "name": "Nickel",
            "density_kg_m3": 8910,
            "cost_usd_per_kg": 25.0
        },
        {
            "name": "Zinc",
            "density_kg_m3": 7140,
            "cost_usd_per_kg": 2.0
        },
        {
            "name": "Magnesium",
            "density_kg_m3": 1740,
            "cost_usd_per_kg": 1.5
        },
        {
            "name": "Tungsten",
            "density_kg_m3": 19250,
            "cost_usd_per_kg": 40.0
        },
        {
            "name": "Silver",
            "density_kg_m3": 10500,
            "cost_usd_per_kg": 500.0
        },
        {
            "name": "Gold",
            "density_kg_m3": 19300,
            "cost_usd_per_kg": 60000.0
        },
        {
            "name": "Platinum",
            "density_kg_m3": 21500,
            "cost_usd_per_kg": 45000.0
        },
        {
            "name": "Alumina (Ceramic)",
            "density_kg_m3": 3970,
            "cost_ug_per_kg": 2.5
        },
        {
            "name": "Titanium Dioxide",
            "density_ug_per_cm³": 4.26,
            "cost_ug_per_kg": 1.8
        },
        {
            "name": "Silicon Carbide",
            "density_ug_per_cm³": 3.215,
            "cost_ug_per_kg": 3.0
        },
        {
            "name": "Boron Nitride",
            "density_ug_per_cm³": 2.4,
            "cost_ug_per_kg": 2.2
        },
        {
            "density": 8960,
            "cost": 4.5,
            "name": "Copper"
        }
    ]

    # payload = {
    #     "operation": "create",
    #     "table": "resources",
    #     "data" : {
    #         "density": 8960,
    #         "cost": 4.5,
    #         "name": "Copper"
    #         }
    # }
    print(payload)
    created_item = get(api_url, payload)
    print(created_item)


    # for item in data:
    #     print(item)
    #     payload = {
    #         "operation": "create",
    #         "table": "resources",
    #         "data" :         {
    #             "density": 8960,
    #             "cost": 4.5,
    #             "name": "Copper"
    #             }
    #     }
    #     created_item = get(api_url, payload)
    #     print(created_item)
