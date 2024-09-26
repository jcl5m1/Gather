from dotenv import load_dotenv
from tinydb import TinyDB, Query
from flask import Flask, request, jsonify, render_template

app = Flask(__name__)

objects_collection = TinyDB('objects.json')

@app.route('/api/object', methods=['GET'])
def get_object():
    obj = objects_collection.search(Query().name.exists())[0]
    print(obj)
    return jsonify(obj)

@app.route('/')
def home():
    return render_template('index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)