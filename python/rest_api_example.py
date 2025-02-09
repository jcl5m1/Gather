import requests
import json

# Example using JSONPlaceholder - a free fake REST API service
api_url = "https://script.google.com/macros/s/AKfycbxGMvkhLAjQ1yv-nfOyV_Y5rPPHocETUQm8Pifvh7KxF4JafTw4wVwjc2M8-3b3CLM8Mw/exec"


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
            "name":"Jupiter",
            "mass": 80,
        }
    }
    payload = {
        "operation": "read",
        "table": "bodies",
        "id": 4
    }

    created_item = get(api_url, payload)
