const SCWorker = require('socketcluster/scworker');
const express = require('express');
const serveStatic = require('serve-static');
const path = require('path');
const morgan = require('morgan');
const healthChecker = require('sc-framework-health-check');
const bodyParser = require('body-parser');
const jwt_decode = require('jwt-decode');
const config = require('./config.json');
const mongodb_utils = require('./utils/mongodb_utils');
const redis_utils = require('./utils/redis_utils');
const moment = require('moment');
const constant = require("./commons/constant");
const _ = require('lodash');
const ObjectID = require('mongodb').ObjectID;
const elastic_search = require('elasticsearch');

const redis = redis_utils.create_redis_client();
const elastic_search_client = new elastic_search.Client({
    host: config.elastic_search_endpoint
});

const reaction_data = [constant.reaction.like, constant.reaction.love];
const kafka_utils = require('./utils/kafka_utils');

class Worker extends SCWorker {
    run() {
        console.log('   >> Worker PID:', process.pid);
        let environment = this.options.environment;

        let httpServer = this.httpServer;
        let scServer = this.scServer;
        // const mongodb = mongodb_utils.mongodb_client();
        const list_user = [];

        if (environment === 'dev') {
            // Log every HTTP request. See https://github.com/expressjs/morgan for other
            // available formats.
            app.use(morgan('dev'));
        }
        app.use(serveStatic(path.resolve(__dirname, 'public')));

        // Add GET /health-check express route
        healthChecker.attach(this, app);

        httpServer.on('request', app);

        let count = 0;

        /*
          In here we handle our incoming realtime connections and listen for events.
        */
        scServer.on('connection', function (socket) {
            console.log(socket.id);

            socket.on('disconnect', (data) => {
                const room_id = socket.room_id || '';
                const close_user_id = socket.user_id;
                mongodb_utils.update({"user_id": close_user_id}, {$set: {"is_online": config.status_offline}}, config.dm_online_status, (err, result) => {
                    if (result) {
                        // just for live stream
                        if (room_id) {
                            mongodb_utils.find_with_join([
                                {$match: {"room_id": room_id}},
                                {
                                    "$lookup": {
                                        "from": "dm_online_status",
                                        "localField": "user_id",
                                        "foreignField": "user_id",
                                        "as": "online_status",
                                    }
                                },
                                {$unwind: "$online_status"},
                                {"$match": {"online_status.is_online": 1}},
                                {$count: "total_view"}
                            ], config.dm_members, (err, result) => {
                                scServer.exchange.publish(room_id + '_total_view', result);
                            });
                        }
                    }
                });
                const index = list_user.findIndex(user => user.socket_id === socket.id);
                list_user.splice(index, 1);
                scServer.exchange.publish(constant.onlines, list_user);
                if (socket.user_id && socket.room_id) {
                    // send message to kafka
                    kafka_utils.send_message({'user_id': socket.user_id, 'room_id': socket.room_id, 'timestamp': get_datetime_now(), 'is_join': false});
                }
            });

            socket.on(constant.channel_info, function (data) {
                if (data) {
                    const token = get_valid_data(data, constant.token, '');
                    const name = get_valid_data(data, constant.name, '');
                    const user_id = get_valid_data(data, constant.id, '');
                    const room_id = get_valid_data(data, constant.room_id, '');

                    // send message to kafka
                    if (user_id && room_id) {
                        kafka_utils.send_message({'user_id': user_id, 'room_id': room_id, 'timestamp': get_datetime_now(), 'is_join': true});
                    }

                    if (token && name && user_id) {
                        mongodb_utils.find({"user_id": user_id}, 1, config.dm_online_status, (err, result) => {
                            if (result && result.length > 0 && result[0]) {
                                mongodb_utils.update({"user_id": user_id}, {$set: {"is_online": config.status_online}}, config.dm_online_status, (err, result) => {
                                });
                            } else {
                                mongodb_utils.insert({"user_id": user_id, "is_online": config.status_online}, config.dm_online_status, (err, result) => {
                                });
                            }
                        });

                        const is_exist = list_user.some(e => e.id === user_id);
                        if (is_exist) {
                            return;
                        }
                        socket.username = name;
                        socket.user_id = user_id;
                        let jwt_token = token.split(" ");
                        if (jwt_token && jwt_token.length === 2 && jwt_token[0] && jwt_token[1]) {
                            const jwt_prefix = jwt_token[0].toLowerCase();
                            const jwt = jwt_token[1];
                            if (jwt_prefix === config.token_prefix) {
                                const decoded = jwt_decode(jwt);
                                let redis_key = decoded.channel_id + "_" + decoded.device_id;
                                redis.get(redis_key.toLowerCase(), (err, resRead) => {
                                    if (!err && resRead) {
                                        socket.is_authen = true;
                                        if (socket.is_authen) {
                                            list_user.push(data);
                                            // push list online channels
                                            scServer.exchange.publish(constant.onlines, list_user);

                                            // just for live stream
                                            if (room_id) {
                                                socket.room_id = room_id;
                                                const object_room = {"room_id": room_id, "room_name": guid(false), "created_date": get_datetime_now()};
                                                mongodb_utils.find({"room_id": room_id}, 1, config.dm_rooms, (err, result) => {
                                                    if (!result || result.length <= 0) {
                                                        mongodb_utils.insert(object_room, config.dm_rooms, (err, result) => {
                                                        });
                                                    }
                                                    const object_member = {
                                                        "user_id": user_id,
                                                        "room_id": room_id,
                                                        "status": config.status_member_active,
                                                        "created_date": get_datetime_now()
                                                    };
                                                    push_total_view_by_room_id(user_id, room_id, object_member);
                                                });
                                            }
                                        } else {
                                            socket.disconnect();
                                        }
                                    }
                                });
                            } else {
                                socket.disconnect();
                            }
                        }
                    } else {
                        if (room_id && user_id) {
                            socket.user_id = user_id;
                            socket.room_id = room_id;
                            mongodb_utils.find({"user_id": user_id}, 1, config.dm_online_status, (err, result) => {
                                if (result && result.length > 0 && result[0]) {
                                    mongodb_utils.update({"user_id": user_id}, {$set: {"is_online": config.status_online}}, config.dm_online_status, (err, result) => {
                                    });
                                } else {
                                    mongodb_utils.insert({"user_id": user_id, "is_online": config.status_online}, config.dm_online_status, (err, result) => {
                                    });
                                }
                            });
                            const object_room = {"room_id": room_id, "room_name": guid(false), "created_date": get_datetime_now()};
                            mongodb_utils.find({"room_id": room_id}, 1, config.dm_rooms, (err, result) => {
                                if (!result || result.length <= 0) {
                                    mongodb_utils.insert(object_room, config.dm_rooms, (err, result) => {
                                    });
                                }
                                const object_member = {
                                    "user_id": user_id,
                                    "room_id": room_id,
                                    "status": config.status_member_active,
                                    "created_date": get_datetime_now()
                                };
                                push_total_view_by_room_id(user_id, room_id, object_member);
                            });
                        }
                    }
                }
            });

            socket.on(constant.need_connected, (data) => {
                if (data && socket.is_authen) {
                    const current_user_id = get_valid_data(data, constant.current_channel_id, '');
                    const connect_user_id = get_valid_data(data, constant.connect_channel_id, '');
                    if (connect_user_id && current_user_id) {
                        mongodb_utils.find({"user_id": current_user_id}, 0, config.dm_members, (err, result) => {
                            if (result && result.length > 0) {
                                let room_id_current_user = '';
                                let is_insert = true;
                                let promises_member = result.map(item => {
                                    return new Promise((resolve, reject) => {
                                        room_id_current_user = item.room_id;
                                        mongodb_utils.find({"user_id": connect_user_id}, 0, config.dm_members, (err, result) => {
                                            if (result && result.length > 0) {
                                                const is_existed = result.some(item => item.room_id === room_id_current_user);
                                                if (is_existed) {
                                                    is_insert = false;
                                                }
                                                resolve(true);
                                            }
                                        });
                                    });
                                });

                                Promise.all(promises_member).then(() => {
                                    if (is_insert) {
                                        const room_id_generated = guid();
                                        const room_name = guid(false);
                                        const object_room = {"room_id": room_id_generated, "room_name": room_name, "created_date": get_datetime_now()};
                                        // create room info
                                        mongodb_utils.insert(object_room, config.dm_rooms, (err, result) => {
                                            if (result && result.result && result.result.ok && result.result.ok === 1) {
                                                const list_user_create_room = [current_user_id, connect_user_id];
                                                if (list_user_create_room && list_user_create_room.length > 0) {
                                                    let list_insert = [];
                                                    let promises = list_user_create_room.map((item) => {
                                                        return new Promise((resolve, reject) => {
                                                            const object_member = {
                                                                "user_id": item,
                                                                "room_id": room_id_generated,
                                                                "status": config.status_member_active,
                                                                "created_date": get_datetime_now()
                                                            };
                                                            list_insert.push(object_member);
                                                            resolve(true);
                                                        });
                                                    });

                                                    Promise.all(promises).then(() => {
                                                        if (list_insert && list_insert.length > 0) {
                                                            mongodb_utils.insert_many(list_insert, config.dm_members, (err, result) => {
                                                            });
                                                        }
                                                    });
                                                }
                                                // push socket notify each user to subscribe
                                                scServer.exchange.publish(current_user_id, room_id_generated);
                                                scServer.exchange.publish(connect_user_id, room_id_generated);
                                            }
                                        });
                                    } else {
                                        // push socket notify each user to subscribe
                                        scServer.exchange.publish(current_user_id, room_id_current_user);
                                        scServer.exchange.publish(connect_user_id, room_id_current_user);
                                    }
                                }).catch(err => {
                                    console.log(err);
                                });
                            } else {
                                const room_id_generated = guid();
                                const room_name = guid(false);
                                const object_room = {"room_id": room_id_generated, "room_name": room_name, "created_date": get_datetime_now()};
                                // create room info
                                mongodb_utils.insert(object_room, config.dm_rooms, (err, result) => {
                                    if (result && result.result && result.result.ok && result.result.ok === 1) {
                                        const list_user_create_room = [current_user_id, connect_user_id];
                                        if (list_user_create_room && list_user_create_room.length > 0) {
                                            let list_insert = [];
                                            let promises = list_user_create_room.map((item) => {
                                                return new Promise((resolve, reject) => {
                                                    const object_member = {
                                                        "user_id": item,
                                                        "room_id": room_id_generated,
                                                        "status": config.status_member_active,
                                                        "created_date": get_datetime_now()
                                                    };
                                                    list_insert.push(object_member);
                                                    resolve(true);
                                                });
                                            });

                                            Promise.all(promises).then(() => {
                                                if (list_insert && list_insert.length > 0) {
                                                    mongodb_utils.insert_many(list_insert, config.dm_members, (err, result) => {
                                                    });
                                                }
                                            }).catch(err => {
                                                console.log('create room info error: ' + err);
                                            });
                                        }
                                        // push socket notify each user to subscribe
                                        scServer.exchange.publish(current_user_id, room_id_generated);
                                        scServer.exchange.publish(connect_user_id, room_id_generated);
                                    }
                                });
                            }
                        })
                    }
                }
            });

            //normal message
            socket.on(constant.chat, (data) => {
                if (data && socket.is_authen) {
                    const private_channel_key = get_valid_data(data, 'private_channel', '');
                    const user_info = get_valid_data(data, 'user_info', '');
                    const message = data.message;
                    // Get members in room with online status
                    mongodb_utils.find_with_join([{$match: {"room_id": private_channel_key}}, {
                        "$lookup": {
                            "from": config.dm_online_status,
                            "localField": "user_id",
                            "foreignField": "user_id",
                            "as": "online_status"
                        }
                    }], config.dm_members, function (err, message_status_result) {
                        const object_data = {
                            'content': message,
                            'room_id': data.private_channel,
                            'user_id': user_info.user_id,
                            'created_date': get_datetime_now(),
                            // 'status': message_status //0: pending; 1: sent; 2: received/unread 3: read
                            'ip': data.ip ? data.ip : '',
                            'extra': data.extra ? data.extra : {}
                        };
                        mongodb_utils.insert(object_data, config.dm_messages, (err, result) => {
                            if (result && result.result && result.result.ok && result.result.ok === 1) {
                                const chat_data = result.ops ? result.ops : [];
                                chat_data[0]['user_info'] = user_info;
                                chat_data[0]['is_reaction'] = reaction_data.indexOf(message) > -1;
                                if (message_status_result && message_status_result.length > 0) {
                                    message_status_result.forEach((item) => {
                                        if (item) {
                                            const online_status_result = (item.online_status && item.online_status[0]) ? item.online_status[0] : {};
                                            const object_message_status = {
                                                "room_id": item.room_id,
                                                "user_id": item.user_id,
                                                "status": item.user_id.toLowerCase() === socket.user_id.toLowerCase() ? config.status_message_read : online_status_result.is_online === 1 ? config.status_message_received_unread : config.status_message_sent,
                                                "lasted_updated": get_datetime_now()
                                            };
                                            mongodb_utils.upsert({
                                                "user_id": online_status_result.user_id,
                                                "room_id": item.room_id
                                            }, object_message_status, config.dm_messages_status, (err, result) => {

                                            });
                                        }
                                    });
                                }
                                scServer.exchange.publish(private_channel_key, chat_data);
                            }
                        });
                    });
                }
            });

            // reaction message
            socket.on(constant.chat_reaction, (data) => {
                // const redis_key = socket.id + "_" + 'reaction_message';
                const limit_message = data && data['reaction_limit_message'] ? data['reaction_limit_message'] : constant.reaction_limit_message;
                const expire_time = data && data['reaction_expire_time'] ? data['reaction_expire_time'] : constant.reaction_expire_time;
                const redis_key = get_valid_data(data, constant.limit_reaction_key, '');
                const user_info = get_valid_data(data, 'user_info', '');
                const private_channel_key = get_valid_data(data, 'private_channel', '');
                if (redis_key) {
                    redis.exists(redis_key, (err, resRead) => {
                        if (!err && resRead === 1) {
                            redis.get(redis_key, function (err, resRead) {
                                if (!err && resRead) {
                                    if (parseInt(resRead) < parseInt(limit_message)) {
                                        let total_reaction_message = parseInt(resRead) + 1;
                                        redis.set(redis_key, total_reaction_message);
                                        redis.expire(redis_key, expire_time);
                                        upsert_reaction_message(data);
                                    } else {
                                        scServer.exchange.publish(user_info.user_id, {"content": constant.reaching_the_limit});
                                    }
                                }
                            });
                        } else {
                            redis.set(redis_key, 1);
                            redis.expire(redis_key, constant.reaction_expire_time);
                            upsert_reaction_message(data);
                        }
                    });
                }
            });

            let upsert_reaction_message = (data) => {
                const private_channel_key = get_valid_data(data, 'private_channel', '');
                const user_info = get_valid_data(data, 'user_info', '');
                const message = data.message;
                if (data && data.ip && private_channel_key) {
                    const object_data = {
                        'content': message,
                        'room_id': private_channel_key,
                        'channel_id': user_info && user_info.user_id ? user_info.user_id : '',
                        'created_date': get_datetime_now(),
                        'ip': data.ip ? data.ip : '',
                        'extra': data.extra ? data.extra : {}
                    };
                    mongodb_utils.insert(object_data, config.dm_reaction_messages, (err, result) => {
                        if (result && result.result && result.result.ok && result.result.ok === 1) {
                            const chat_data = result.ops ? result.ops : [];
                            if (chat_data[0]['user_info']) {
                                chat_data[0]['user_info'] = user_info;
                            }
                            chat_data[0]['is_reaction'] = reaction_data.indexOf(message) > -1;
                            scServer.exchange.publish(private_channel_key, chat_data);
                        }
                    });
                }
            };

            let push_total_view_by_room_id = (user_id, room_id, object_member) => {
                mongodb_utils.upsert({"user_id": user_id, "room_id": room_id}, object_member, config.dm_members, (err, result) => {
                    if (!err) {
                        const redis_key = constant.key_redis_last_time_push_total_view + room_id;
                        redis.exists(redis_key, (err, resRead) => {
                            if (!err && resRead !== 1) {
                                mongodb_utils.find_with_join([
                                    {$match: {"room_id": room_id}},
                                    {
                                        "$lookup": {
                                            "from": "dm_online_status",
                                            "localField": "user_id",
                                            "foreignField": "user_id",
                                            "as": "online_status",
                                        }
                                    },
                                    {$unwind: "$online_status"},
                                    {"$match": {"online_status.is_online": 1}},
                                    {$count: "total_view"}
                                ], config.dm_members, (err, result) => {
                                    scServer.exchange.publish(room_id + '_total_view', result);
                                    redis.set(redis_key, result[0].total_view);
                                    redis.expire(redis_key, constant.range_time_push_total_view);
                                });
                            }
                        });
                    }
                });
            };
        });
    }
}

const app = express();
const router = express.Router();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

// middleware to use for all requests
router.use(function (req, res, next) {
    // do logging
    res.header("Access-Control-Allow-Origin", "*");
    res.header('Access-Control-Allow-Methods', 'DELETE, PUT, GET, POST');
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    const req_header = req.headers;
    const token = req_header.authorization;
    if (token) {
        let jwt_token = token.split(" ");
        if (jwt_token && jwt_token.length === 2 && jwt_token[0] && jwt_token[1]) {
            const jwt_prefix = jwt_token[0].toLowerCase();
            const jwt = jwt_token[1];
            if (jwt_prefix === config.token_prefix) {
                const decoded = jwt_decode(jwt);
                let redis_key = decoded.channel_id + "_" + decoded.device_id;
                redis.get(redis_key.toLowerCase(), (err, resRead) => {
                    if (resRead) {
                        next();
                    } else {
                        res.json(return_object("Error decoding signature.", false, {}));
                    }
                });
            } else {
                res.json(return_object("Error decoding signature.", false, {}));
            }
        } else {
            res.json(return_object("Error decoding signature.", false, {}));
        }
    } else {
        res.json(return_object("Error decoding signature.", false, {}));
    }
});

// API get message histories
router.route('/dm/:room_id/:user_id')
    .get(function (req, res) {
        const room_id = req.params.room_id;
        const user_id = req.params.user_id;
        const lasted_message_date = req.query.lasted_message_date ? req.query.lasted_message_date : "";
        const limit = req.query.limit ? req.query.limit : 10;
        if (room_id && user_id) {
            const query = lasted_message_date ? {"room_id": room_id, "created_date": {$lt: lasted_message_date}} : {"room_id": room_id};
            mongodb_utils.find_with_join([{$match: query}, {
                "$lookup": {
                    "from": config.dm_messages_status,
                    pipeline: [
                        {$match: {"user_id": user_id}}
                    ],
                    "as": "message_status",
                }
            }, {$unwind: "$message_status"}], config.dm_messages, (err, result) => {
                if (result && result.length > 0) {
                    result = _.orderBy(result, 'created_date', 'asc');
                    let user_ids = [];
                    result.map(item => {
                        if (user_ids.indexOf(item.user_id) === -1)
                            user_ids.push(item.user_id);
                    });
                    if (user_ids && user_ids.length > 0) {
                        elastic_search_client.search({
                            index: config.elastic_search_uer_index,
                            body: {
                                "query": {
                                    "terms": {
                                        "id": user_ids && user_ids.length > 0 ? user_ids : []
                                    }
                                },
                                "_source": {
                                    "includes": [
                                        "id", "fullname"
                                    ]
                                }
                            }
                        }, function (err, es_results) {
                            if (err) res.json(return_object("", false, {}));
                            if (es_results && es_results.hits && es_results.hits.hits && es_results.hits.hits.length > 0) {
                                const es_results_hits = es_results.hits.hits;
                                result.map(item => {
                                    const user_id = item.user_id;
                                    const message_content = item.content;
                                    es_results_hits.map(es_item => {
                                        const obj = es_item._source;
                                        const es_user_id = obj.id;
                                        if (user_id === es_user_id) {
                                            item["user_info"] = {
                                                "id": user_id,
                                                "name": obj.fullname
                                            }
                                        }
                                        item["is_reaction"] = reaction_data.indexOf(message_content) > -1;
                                    });
                                });
                                res.json(return_object("", true, {'items': result}));
                            }
                        });
                    } else {
                        res.json(return_object("", true, {}));
                    }
                } else {
                    res.json(return_object("", true, {}));
                }
            });
        } else {
            res.json(return_object("", false, {}));
        }
    })

    // call api when user delete conversation
    .delete(function (req, res) {
        const req_body = req.body;
        const room_id = req.params.room_id;
        const user_id = req.params.user_id;
        if (room_id && user_id) {
            mongodb_utils.update({"user_id": user_id, "room_id": room_id}, {$set: {"status": config.status_member_deactive}}, config.dm_members, (err, result) => {
                if (err) {
                    res.json(return_object("", false, {}));
                } else {
                    res.json(return_object("", true, {}));
                }
            });
        } else {
            res.json(return_object("", false, {}));
        }
    });

// update message as read
router.route('/dm/:message_id')
    .put(function (req, res) {
        mongodb_utils.update({"_id": ObjectID(req.params.message_id)}, {$set: {"status": config.status_message_read}}, config.dm_messages_status, (err, result) => {
            if (err) {
                res.json(return_object("", false, {}));
            } else {
                res.json(return_object("", true, {}));
            }
        });
    });

// get total viewer information in 1 room
router.route('/total_view/:room_id/')
    .get(function (req, res) {
        const room_id = req.params.room_id;
        const page_index = req.query.page_index ? parseInt(req.query.page_index) : 1;
        const page_size = req.query.page_size ? parseInt(req.query.page_size) : 20;
        const is_livestream = req.query.is_livestream ? req.query.is_livestream : false;
        if (room_id) {
            let total_count = 0;
            mongodb_utils.find_with_join([
                {$match: {"room_id": room_id}},
                {
                    "$lookup": {
                        "from": "dm_online_status",
                        "localField": "user_id",
                        "foreignField": "user_id",
                        "as": "online_status",
                    }
                },
                {$unwind: "$online_status"},
                {"$match": {"online_status.is_online": 1}},
                {$count: "total_view"}
            ], config.dm_members, (err, result) => {
                if (result) {
                    total_count = parseInt(result[0].total_view);
                }
            });

            mongodb_utils.find_with_join([
                {$match: {"room_id": room_id}},
                {
                    "$lookup": {
                        "from": "dm_online_status",
                        "localField": "user_id",
                        "foreignField": "user_id",
                        "as": "online_status",
                    }
                },
                {"$match": {"online_status.is_online": 1}},
                {$skip: (page_size * page_index) - page_size},
                {$limit: page_size},
                {"$unwind": "$online_status"}
            ], config.dm_members, (err, result) => {
                let user_ids = [];
                if (result && result.length > 0) {
                    result.map(item => {
                        if (user_ids.indexOf(item.user_id) === -1)
                            user_ids.push(item.user_id);
                    });
                }

                if (user_ids && user_ids.length > 0) {
                    elastic_search_client.search({
                        index: is_livestream ? constant.elastic_search_channel_index : constant.elastic_search_uer_index,
                        body: {
                            "query": {
                                "terms": {
                                    "id": user_ids && user_ids.length > 0 ? user_ids : []
                                }
                            },
                            "_source": {
                                "includes": [
                                    "id", is_livestream ? "name" : "fullname"
                                ]
                            }
                        }
                    }, (err, es_results) => {
                        if (err) res.json(return_object("", false, {}));
                        if (es_results && es_results.hits && es_results.hits.hits && es_results.hits.hits.length > 0) {
                            const es_results_hits = es_results.hits.hits;
                            result.map(item => {
                                const user_id = item.user_id;
                                es_results_hits.map(es_item => {
                                    const obj = es_item._source;
                                    const es_user_id = obj.id;
                                    if (user_id === es_user_id) {
                                        item["user_info"] = {
                                            "id": user_id,
                                            "name": is_livestream ? obj.name : obj.fullname
                                        }
                                    }
                                });
                            });
                            const paging = {
                                'page_count': _calc_page_count(total_count, page_size),
                                'page_index': page_index,
                                'page_size': page_size,
                                'total_count': total_count
                            };
                            res.json(return_object("", true, {'items': result, 'paging': paging}));
                        } else {
                            res.json(return_object("", false, {}));
                        }
                    });
                } else {
                    res.json(return_object("", false, {}));
                }
            })
        } else {
            res.json(return_object("", false, {}));
        }
    });

// get reaction icon constants
// router.route('/dm/reaction')
app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Pass to next layer of middleware
    next();
});

app.get('/dm/reaction', function (req, res) {
    const result = [
        {
            'id': constant.reaction.like,
            'name': 'like'
        },
        {
            'id': constant.reaction.love,
            'name': 'love'
        }
    ];
    if (result) {
        res.json(return_object("", true, {'items': result}));
    } else {
        res.json(return_object("", true, {}));
    }
});

router.route('/reaction_dm/:room_id')
    .get(function (req, res) {
        const room_id = req.params.room_id;
        const lasted_message_date = req.query.lasted_message_date ? req.query.lasted_message_date : "";
        const limit = req.query.limit ? req.query.limit : 10;
        if (room_id) {
            const query = lasted_message_date ? {"room_id": room_id, "created_date": {$lt: lasted_message_date}} : {"room_id": room_id};
            mongodb_utils.find(query, limit, config.dm_reaction_messages, (err, result) => {
                if (result && result.length > 0) {
                    res.json(return_object("", true, {'items': result}));
                } else {
                    res.json(return_object("", true, {}));
                }
            });
        } else {
            res.json(return_object("", false, {}));
        }
    });

app.use('/v1', router);

let _calc_page_count = (total_count, page_size) => Math.ceil(total_count / page_size);

let return_object = (message = "", is_success = true, data = {}) => ({"message": message, "success": is_success, "data": data});

let get_valid_data = (data, key, default_value) => (data && data[key]) ? data[key] : default_value;

let guid = (is_id = true) => {
    let s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    return is_id === true ? s4() + s4() + s4() + s4() + s4() + s4() + s4() + s4() : s4() + s4();
};

let get_datetime_now = () => moment.utc().toISOString();

new Worker();
