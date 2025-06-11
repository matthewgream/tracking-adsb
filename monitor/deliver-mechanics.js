// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const { MqttClient } = require('./function-mqtt.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class DeliveryMechanics {
    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            logger: options.logger || console.error,

            // Console display options
            console: {
                enabled: options.console?.enabled !== false,
                showRemoves: options.console?.showRemoves || false,
                ...options.console,
            },

            // MQTT options
            mqtt: options.mqtt || {},
        };

        // MQTT client instance
        this.mqttClient = undefined;

        // Statistics
        this.stats = {
            alerts: {
                inserted: 0,
                removed: 0,
            },
            state: {
                published: 0,
            },
            mqtt: {
                connected: false,
                published: 0,
                errors: 0,
            },
        };

        // Initialize
        this._initialize();
    }

    async destroy() {
        if (this.mqttClient) {
            try {
                await this.mqttClient.end();
                this._log('mqtt client disconnected');
            } catch (e) {
                this._log('mqtt disconnect error:', e.message);
            }
            this.mqttClient = undefined;
            this.stats.mqtt.connected = false;
        }
    }

    _initialize() {
        // Initialize MQTT if configured
        if (this.options.mqtt && this.options.mqtt.enabled) {
            try {
                this.mqttClient = new MqttClient(this.options.mqtt);
                this.mqttClient.begin((topic, message) => {
                    if (this.options.debug) {
                        this._log(`mqtt received: '${topic}' => '${message}' [IGNORED]`);
                    }
                });
                this.stats.mqtt.connected = true;
                this._log('mqtt client initialized');
            } catch (e) {
                this._log('mqtt initialization failed:', e.message);
                this.stats.mqtt.connected = false;
            }
        }
    }

    //

    deliverAlerts(alerts) {
        const { alertsInserted = [], alertsRemoved = [] } = alerts;

        // Process insertions
        if (alertsInserted.length > 0) {
            this._publish('alert', 'insert', alertsInserted);
            this._display('alert', 'insert', alertsInserted);
            this.stats.alerts.inserted += alertsInserted.length;
        }

        // Process removals
        if (alertsRemoved.length > 0) {
            this._publish('alert', 'remove', alertsRemoved);
            if (this.options.console.showRemoves) {
                this._display('alert', 'remove', alertsRemoved);
            }
            this.stats.alerts.removed += alertsRemoved.length;
        }
    }

    deliverStatus(data) {
        if (data && Object.keys(data).length > 0) {
            this._publish('status', 'loop', [data]);
            this._display('status', 'loop', data);
            this.stats.state.published++;
        }
    }

    //

    _display(type, sub, data) {
        if (!this.options.console.enabled) return;

        if (type === 'alert' && sub === 'insert') {
            data.forEach((item) => {
                const notice = item.warn ? ' [NOTICE]' : '';
                console.log(`${item.timeFormatted} ${type.toUpperCase()}/${sub} [${item.type}] ${item.flight} ${item.text}${notice}`);
            });
        } else if (type === 'alert' && sub === 'remove' && this.options.console.showRemoves) {
            data.forEach((item) => {
                console.log(`${new Date().toISOString()} ${type.toUpperCase()}/${sub} ${item}`);
            });
        } else if (type === 'status' && sub === 'loop') {
            Object.entries(data.status).forEach(([name, details]) => details.text && console.log(`${data.timeFormatted} ${type.toUpperCase()}/${name} ${details.text}`));
        }
    }

    _publish(type, sub, data) {
        if (!this.mqttClient || !this.stats.mqtt.connected) return;

        const topicConfig = this.options.mqtt.publishTopics?.[type];
        if (!topicConfig) return;

        try {
            data.forEach((item) => {
                const topic = [topicConfig, sub].join('/');
                this.mqttClient.publish(topic, item);
                this.stats.mqtt.published++;

                if (this.options.debug) {
                    this._log(`mqtt published to ${topic}`);
                }
            });
        } catch (e) {
            this.stats.mqtt.errors++;
            this._log('mqtt publish error:', e.message);
        }
    }

    //

    getInfo() {
        const outputs = [];

        if (this.options.console.enabled) {
            outputs.push('console');
        }

        if (this.mqttClient) {
            const mqttInfo = this.options.mqtt.brokerUrl || 'configured';
            outputs.push(`mqtt(${mqttInfo})`);
        }

        return outputs.length > 0 ? `outputs: ${outputs.join(', ')}` : 'no outputs configured';
    }

    getStats() {
        return {
            ...this.stats,
            uptime: this.startTime ? Date.now() - this.startTime : 0,
        };
    }

    _log(...args) {
        this.options.logger('deliver:', ...args);
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports.DeliveryMechanics = DeliveryMechanics;

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
