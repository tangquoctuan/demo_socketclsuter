const config = require('../config.json');
let kafka = require('kafka-node'),
    Producer = kafka.Producer,
    client = new kafka.KafkaClient({kafkaHost: config.kafka_server_list}),
    producer = new Producer(client);
let timeToRetryConnection = 10 * 1000; // 12 seconds
let reconnectInterval = null;

producer.on('ready', function () {
    console.log('Kafka producer ready');
    if (reconnectInterval != null) {
        reconnectInterval = null;
    }
});

producer.on('error', function (err) {
    producer.close();
    client.close(); // Comment out for client on close
    if (reconnectInterval == null) { // Multiple Error Events may fire, only set one connection retry.
        reconnectInterval =
            setTimeout(function () {
                console.log("Reconnect is called in producer error event");
                client = new kafka.KafkaClient(config.kafka_server_list);
                producer = new Producer(client);
            }, timeToRetryConnection);
    }
});

function send_message(payloads, topic) {
    if (payloads) {
        let send_topic = typeof(topic) !== "undefined" && topic ? topic : config.kafka_topic;
        const payloads_abc = build_payload_data(payloads, send_topic);
        producer.send(payloads_abc, (err, data) => {
            if (err)
                console.log(err);
        });
    }
}

function build_payload_data(message, topic) {
    let result = {};
    if (message) {
        result = [{topic: topic, messages: JSON.stringify(message), partition: 0}];
    }
    return result;
}

module.exports = {
    send_message: send_message
};