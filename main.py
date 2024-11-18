from dotenv import load_dotenv
from tinydb import TinyDB, Query
from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS
import time, random

app = Flask(__name__, static_folder='dist', template_folder='templates')
CORS(app)  # Enable CORS for all routes

@app.route('/api', methods=['GET'])
def handleGet():
    db = TinyDB('gamedata.json')

    tableId = request.args.get('table')
    if not tableId:
        return jsonify({"error": "Table not specified"}), 400
    table = db.table(tableId)    
    if not table:
        return jsonify({"error": "Table not found"}), 404

    id = request.args.get('id')
    if not id:
        return jsonify(table.all())        
    item = table.search(Query().id == id)
    if not item:
        return jsonify({"error": "Id not found"}), 404
    #print log of endpoint and response
    print(f"GET {request.path}?{request.query_string.decode('utf-8')}")
    return jsonify(item)

@app.route('/api', methods=['POST'])
def handlePost():
    db = TinyDB('gamedata.json')

    data = request.get_json()
    print(data)
    if not data:
        return jsonify({"error": "Invalid input"}), 400
    tableId = data.get('table')
    if not tableId:
        return jsonify({"error": "Table not specified"}), 400
    item = data.get('item')
    if not item:
        return jsonify({"error": "Item not specified"}), 400
    # Assuming the object has an 'id' field
    if 'id' not in item or item['id']=='':
        return jsonify({"error": "Id not specified"}), 400
    itemId = item['id']
    table = db.table(tableId)
    if not table:
        return jsonify({"error": "Table not found"}), 404
    if table.contains(Query().id == itemId):
        table.update(item, Query().id == itemId)
    else:
        table.insert(item)

    # Print log of endpoint and response
    print(f"POST {request.path} - {data}")
    return jsonify({"message": "Item added successfully",
                    "id": item['id'], 
                    "table": tableId}), 201

@app.route('/api', methods=['DELETE'])
def handleDelete():
    db = TinyDB('gamedata.json')

    tableId = request.args.get('table')
    if not tableId:
        return jsonify({"error": "Table not specified"}), 400
    itemId = request.args.get('id')
    if not itemId:
        return jsonify({"error": "Item ID not specified"}), 400
    collection = db.table(tableId)
    if not collection.contains(Query().id == itemId):
        return jsonify({"error": "Item not found"}), 404
    collection.remove(Query().id == itemId)
    # Print log of endpoint and response
    print(f"DELETE {request.path}?{request.query_string.decode('utf-8')}")
    return jsonify({"message": "Item deleted successfully",
                    "id": itemId, 
                    "table": tableId}), 200

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/test')
def test():
    return render_template('test.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8010, debug=True)