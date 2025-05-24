// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

const mqtt = require('mqtt');
let config = {};
let client;
let receiver;

function mqttReceive(topic, message) {
    try {
        if (receiver) receiver(topic, message);
    } catch (e) {
        console.error(`mqtt: receiver on '${topic}', error (exception):`, e);
    }
}

function mqttPublish(topic, message, options = {}) {
    if (client)
        try {
            const payload = typeof message === 'object' ? JSON.stringify(message) : message;
            client.publish(topic, payload, options, (err) => {
                if (err) console.error(`mqtt: publish to '${topic}', error:`, err);
                else if (config.debug) console.log(`mqtt: published to '${topic}'`);
            });
            return true;
        } catch (e) {
            console.error(`mqtt: publish error:`, e);
        }
    return false;
}

function mqttSubscribe() {
    if (client) {
        if (Array.isArray(config.topics))
            config.topics.forEach((topic) =>
                client.subscribe(topic, (err) => {
                    if (err) console.error(`mqtt: subscribe to '${topic}', error:`, err);
                    else console.log(`mqtt: subscribe to '${topic}', succeeded`);
                })
            );
    }
}

function mqttBegin(r) {
    const options = {
        clientId: config.clientId,
    };
    if (config.username && config.password) {
        options.username = config.username;
        options.password = config.password;
    }
    receiver = r;
    console.log(`mqtt: connecting to '${config.server}'`);
    client = mqtt.connect(config.server, options);
    if (client) {
        client.on('connect', () => {
            console.log('mqtt: connected');
            mqttSubscribe();
        });
        client.on('message', (topic, message) => {
            mqttReceive(topic, message);
        });
        client.on('error', (err) => console.error('mqtt: error:', err));
        client.on('offline', () => console.warn('mqtt: offline'));
        client.on('reconnect', () => console.log('mqtt: reconnect'));
    }
    console.log(`mqtt: loaded using 'server=${config.server},client=${config.clientId},topics=${Array.isArray(config.topics) ? config.topics.join(',') : ''}'`);
}

function mqttEnd() {
    if (client) {
        client.end();
        client = undefined;
    }
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

module.exports = function (c) {
    config = c;
    return {
        begin: mqttBegin,
        end: mqttEnd,
        publish: mqttPublish,
    };
};

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------
