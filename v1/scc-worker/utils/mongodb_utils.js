const MongoClient = require('mongodb').MongoClient;
const config = require('../config.json');
const format = require('string-format');

function mongodb_client(callback) {
    const db_name = config.mongo_database_name;
    const collection_name = config.mongo_collection;
    let result = is_insert ? false : [];
    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {
        console.log("Connected successfully to server mongodb");
        let db_connected = client.db(db_name);
        callback(err, client);
    });
}

function insert(docs, collection, callback) {
    if (docs) {
        const bind_collection = collection;
        MongoClient.connect(config.mongo_endpoint, {
            useNewUrlParser: true,
            auth: {user: config.mongo_username, password: config.mongo_password},
            authSource: config.mongo_database_name
        }, function (err, client) {
            if (err) return console.log(err);
            let db_connected = client.db(config.mongo_database_name);
            const collection = db_connected.collection(bind_collection);
            if (collection) {
                collection.insert(docs, function (err, result) {
                    callback(err, result);
                })
            }
            client.close();
        });
    }
}

function insert_many(docs, collection, callback) {
    if (docs) {
        const bind_collection = collection;
        MongoClient.connect(config.mongo_endpoint, {
            useNewUrlParser: true,
            auth: {user: config.mongo_username, password: config.mongo_password},
            authSource: config.mongo_database_name
        }, function (err, client) {
            if (err) return console.log(err);
            let db_connected = client.db(config.mongo_database_name);
            const collection = db_connected.collection(bind_collection);
            if (collection) {
                collection.insertMany(docs, function (err, result) {
                    callback(err, result);
                })
            }
            client.close();
        });
    }
}

function find(query, limit, collection, callback) {
    if (query) {
        const bind_collection = collection;
        MongoClient.connect(config.mongo_endpoint, {
            useNewUrlParser: true,
            auth: {user: config.mongo_username, password: config.mongo_password},
            authSource: config.mongo_database_name
        }, function (err, client) {
            if (err) return console.log(err);
            let db_connected = client.db(config.mongo_database_name);
            const collection = db_connected.collection(bind_collection);
            if (collection) {
                if (limit > 0) {
                    collection.find(query).limit(limit).sort({'created_date': -1}).toArray(function (err, docs) {
                        callback(err, docs);
                    });
                } else {
                    collection.find(query).sort({'created_date': -1}).toArray(function (err, docs) {
                        callback(err, docs);
                    });
                }
            }
            client.close();
        });
    }
}

function find_one(query, collection, callback) {
    if (query) {
        const bind_collection = collection;
        MongoClient.connect(config.mongo_endpoint, {
            useNewUrlParser: true,
            auth: {user: config.mongo_username, password: config.mongo_password},
            authSource: config.mongo_database_name
        }, function (err, client) {
            if (err) return console.log(err);
            let db_connected = client.db(config.mongo_database_name);
            const collection = db_connected.collection(bind_collection);
            if (collection) {
                collection.findOne(query, function (err, docs) {
                    callback(err, docs);
                });
            }
            client.close();
        });
    }
}

function update(query, update_query, collection, callback) {
    if (query) {
        const bind_collection = collection;
        MongoClient.connect(config.mongo_endpoint, {
            useNewUrlParser: true,
            auth: {user: config.mongo_username, password: config.mongo_password},
            authSource: config.mongo_database_name
        }, function (err, client) {
            let db_connected = client.db(config.mongo_database_name);
            const collection = db_connected.collection(bind_collection);
            if (collection) {
                collection.updateOne(query, update_query, function (err, result) {
                    callback(err, result);
                });
            }
            client.close();
        });
    }
}

function find_with_join(look_up, collection, callback) {
    if (look_up) {
        const bind_collection = collection;
        MongoClient.connect(config.mongo_endpoint, {
            useNewUrlParser: true,
            auth: {user: config.mongo_username, password: config.mongo_password},
            authSource: config.mongo_database_name
        }, function (err, client) {
            let db_connected = client.db(config.mongo_database_name);
            const collection = db_connected.collection(bind_collection);
            if (collection) {
                collection.aggregate(look_up).toArray(function (err, result) {
                    callback(err, result);
                });
            }
            client.close();
        });
    }
}

function upsert(query, update_query, collection, callback) {
    if (query) {
        const bind_collection = collection;
        MongoClient.connect(config.mongo_endpoint, {
            useNewUrlParser: true,
            auth: {user: config.mongo_username, password: config.mongo_password},
            authSource: config.mongo_database_name
        }, function (err, client) {
            let db_connected = client.db(config.mongo_database_name);
            const collection = db_connected.collection(bind_collection);
            if (collection) {
                collection.update(query, update_query, {upsert: true}, function (err, result) {
                    callback(err, result);
                });
            }
            client.close();
        });
    }
}

module.exports = {
    mongodb_client: mongodb_client,
    insert: insert,
    find: find,
    update: update,
    find_with_join: find_with_join,
    upsert: upsert,
    insert_many: insert_many,
    find_one: find_one
};

