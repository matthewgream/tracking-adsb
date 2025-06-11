// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const mqtt = require('mqtt');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class MqttClient {
    constructor(options = {}) {
        this.options = {
            server: options.server || 'mqtt://localhost',
            clientId: options.clientId || `mqtt-client-${Date.now()}`,
            username: options.username,
            password: options.password,
            topics: options.topics || [],
            debug: options.debug || false,
            reconnectPeriod: options.reconnectPeriod || 5000,
            connectTimeout: options.connectTimeout || 30000,
            ...options,
            logger: options.logger || console.error, // Default to console.error
        };

        this.client = undefined;
        this.receiver = undefined;
        this.connected = false;

        this.stats = {
            published: 0,
            received: 0,
            errors: 0,
            reconnects: 0,
        };
    }

    begin(receiver) {
        if (this.client) {
            this._log('already connected');
            return;
        }

        this.receiver = receiver;

        const connectOptions = {
            clientId: this.options.clientId,
            reconnectPeriod: this.options.reconnectPeriod,
            connectTimeout: this.options.connectTimeout,
        };

        if (this.options.username && this.options.password) {
            connectOptions.username = this.options.username;
            connectOptions.password = this.options.password;
        }

        this._log(`connecting to '${this.options.server}'`);

        this.client = mqtt.connect(this.options.server, connectOptions);

        if (!this.client) {
            throw new Error('Failed to create MQTT client');
        }

        this._setupEventHandlers();

        const topicsInfo = this.options.topics.length > 0 ? `, topics=${this.options.topics.join(',')}` : '';
        this._log(`initialized: server=${this.options.server}, client=${this.options.clientId}${topicsInfo}`);
    }

    end() {
        if (!this.client) return Promise.resolve();

        this._log('closing connection');
        this.connected = false;

        return new Promise((resolve) => {
            this.client.end(false, {}, () => {
                this.client = undefined;
                this._log('connection closed');
                resolve();
            });
        });
    }

    publish(topic, message, options = {}) {
        if (!this.client || !this.connected) {
            this._log('cannot publish - not connected');
            return false;
        }

        try {
            const payload = typeof message === 'object' ? JSON.stringify(message) : String(message);

            this.client.publish(topic, payload, options, (error) => {
                if (error) {
                    this.stats.errors++;
                    this._log(`publish error on '${topic}':`, error.message);
                } else {
                    this.stats.published++;
                    if (this.options.debug) {
                        this._log(`published to '${topic}'`);
                    }
                }
            });

            return true;
        } catch (e) {
            this.stats.errors++;
            this._log('publish exception:', e.message);
            return false;
        }
    }

    subscribe(topics) {
        if (!this.client || !this.connected) {
            this._log('cannot subscribe - not connected');
            return;
        }

        const topicsArray = Array.isArray(topics) ? topics : [topics];

        topicsArray.forEach((topic) => {
            this.client.subscribe(topic, (error) => {
                if (error) {
                    this.stats.errors++;
                    this._log(`subscribe error on '${topic}':`, error.message);
                } else {
                    this._log(`subscribed to '${topic}'`);
                }
            });
        });
    }

    isConnected() {
        return this.connected;
    }

    _setupEventHandlers() {
        this.client.on('connect', () => {
            this.connected = true;
            this.connectedAt = Date.now();
            this._log('connected');

            // Auto-subscribe to configured topics
            if (this.options.topics.length > 0) {
                this.subscribe(this.options.topics);
            }
        });

        this.client.on('message', (topic, message) => {
            this.stats.received++;
            this._handleMessage(topic, message);
        });

        this.client.on('error', (error) => {
            this.stats.errors++;
            this._log('error:', error.message);
        });

        this.client.on('offline', () => {
            this.connected = false;
            this._log('offline');
        });

        this.client.on('reconnect', () => {
            this.stats.reconnects++;
            this._log('reconnecting');
        });

        this.client.on('close', () => {
            this.connected = false;
            this._log('connection closed');
        });
    }

    _handleMessage(topic, message) {
        if (!this.receiver) return;

        try {
            const messageStr = message.toString();
            this.receiver(topic, messageStr);
        } catch (e) {
            this.stats.errors++;
            this._log(`receiver error on '${topic}':`, e.message);
        }
    }

    //

    getStats() {
        return {
            ...this.stats,
            connected: this.connected,
            uptime: this.connectedAt ? Date.now() - this.connectedAt : 0,
        };
    }

    _log(...args) {
        this.options.logger('mqtt-client:', ...args);
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports.MqttClient = MqttClient;

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
