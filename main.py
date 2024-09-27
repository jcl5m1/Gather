from dotenv import load_dotenv
from tinydb import TinyDB, Query
from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS
import time, random

app = Flask(__name__, static_folder='dist', template_folder='templates')
CORS(app)  # Enable CORS for all routes


objects_collection = TinyDB('objects.json')

@app.route('/api/object', methods=['GET'])
def get_object():
    id = request.args.get('id')
    if not id:
        return jsonify(objects_collection.all())        
    obj = objects_collection.search(Query().id == id)
    if not obj:
        return jsonify({"error": "Object not found"}), 404
    #print log of endpoint and response
    print(f"GET {request.path}?{request.query_string.decode('utf-8')}")
    return jsonify(obj)


@app.route('/api/addObject', methods=['POST'])
def addObject():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid input"}), 400

    # Assuming the object has an 'id' field
    if 'id' not in data or data['id']=="":
        # Generate a unique id timestamp plus random number
        data['id'] = str(int(time.time() * 1000000)).zfill(4) + str(random.randint(0, 1000)).zfill(3)
    objects_collection.insert(data)
    # Print log of endpoint and response
    print(f"POST {request.path} - {data}")
    return jsonify({"message": "Object added successfully",
                    "id": data['id']}), 201
    # id = request.args.get('id')
    # if not id:
    #     return jsonify(objects_collection.all())        
    # obj = objects_collection.search(Query().id == id)
    # if not obj:
    #     return jsonify({"error": "Object not found"}), 404
    # #print log of endpoint and response
    # print(f"GET {request.path}?{request.query_string.decode('utf-8')}")
#    return jsonify(obj)


@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/test')
def test():
    return render_template('test.html')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8010, debug=True)