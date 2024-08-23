from bson import ObjectId
from fastapi.responses import JSONResponse
from pymongo import MongoClient
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import uvicorn
from dotenv import load_dotenv
import os
from pymongo import MongoClient
from tinydb import TinyDB, Query

app = FastAPI()


# Helper function to convert ObjectId to string
def convert_object_id(data):
    if isinstance(data, list):
        return [convert_object_id(item) for item in data]
    elif isinstance(data, dict):
        return {key: convert_object_id(value) for key, value in data.items()}
    elif isinstance(data, ObjectId):
        return str(data)
    else:
        return data


def connect_to_mongo():
    # Load environment variables from .env file
    load_dotenv()

    # Get MongoDB credentials from environment variables
    mongo_host = os.getenv("MONGO_HOST")
    mongo_username = os.getenv("MONGO_USERNAME")
    mongo_password = os.getenv("MONGO_PASSWORD")

    # Connect to MongoDB
    mongo_uri = f"mongodb+srv://{mongo_username}:{mongo_password}@{mongo_host}/"

    client = MongoClient(mongo_uri)
    db = client["state"]
    # Load the collection objects
    objects_collection = db["objects"]
    return objects_collection

def connect_to_tinyDB():
    # Create a new TinyDB instance (database file will be created in the current directory)
    return TinyDB('objects.json')


USE_TINYDB = True

if USE_TINYDB:
    objects_collection = connect_to_tinyDB()
else:
    objects_collection = connect_to_mongo()


@app.get("/api/object")
def get_object():
    if USE_TINYDB:
        objects_collection = connect_to_tinyDB()
        obj = objects_collection.search(Query().name.exists())[0]
    else:
        obj = objects_collection.find_one()
    if obj:
        obj = convert_object_id(obj)
    print(obj)
    return JSONResponse(content=obj)


# Mount the 'static' directory to serve static files
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

