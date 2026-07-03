from pymongo import MongoClient

# Connect to MongoDB
client = MongoClient('localhost', 27017)

# Access the admin database and test collection
db = client.admin
collection = db.test

# Create a document
document = {'name': 'John Doe'}

# Insert the document into the collection
collection.insert_one(document)

# Close the connection
client.close()