import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { config } from './config.js';
import { logger } from './logger.js';
import { createEnvelope } from '@boardroom/shared';
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
export class Connection extends EventEmitter {
    ws = null;
    backoffMs = INITIAL_BACKOFF_MS;
    reconnectTimer = null;
    intentionalClose = false;
    connect() {
        this.intentionalClose = false;
        this.establishConnection();
    }
    disconnect() {
        this.intentionalClose = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close(1000, 'Executor shutting down');
            this.ws = null;
        }
    }
    send(type, payload) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            logger.warn(`Cannot send ${type}: WebSocket not open`);
            return;
        }
        const envelope = createEnvelope(type, payload, config.agentId);
        this.ws.send(JSON.stringify(envelope));
    }
    get isConnected() {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
    async obtainToken() {
        // Convert ws:// URL to http:// for REST call
        const httpUrl = config.serverUrl
            .replace('ws://', 'http://')
            .replace('wss://', 'https://')
            .replace(/\/ws\/?$/, '');
        const resp = await fetch(`${httpUrl}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: config.agentKey }),
        });
        if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`Login failed (${resp.status}): ${body}`);
        }
        const data = (await resp.json());
        return data.token;
    }
    async establishConnection() {
        let token;
        try {
            token = await this.obtainToken();
        }
        catch (err) {
            logger.error('Failed to obtain auth token', err);
            this.scheduleReconnect();
            return;
        }
        const url = `${config.serverUrl}?token=${token}`;
        logger.info(`Connecting to ${config.serverUrl}...`);
        this.ws = new WebSocket(url);
        this.ws.on('open', () => {
            logger.info('WebSocket connected');
            this.backoffMs = INITIAL_BACKOFF_MS;
            this.emit('connected');
        });
        this.ws.on('message', (data) => {
            try {
                const envelope = JSON.parse(data.toString());
                this.emit('message', envelope);
            }
            catch (err) {
                logger.error('Failed to parse incoming message', err);
            }
        });
        this.ws.on('close', (code, reason) => {
            logger.warn(`WebSocket closed: code=${code} reason=${reason.toString()}`);
            this.ws = null;
            this.emit('disconnected');
            if (!this.intentionalClose) {
                this.scheduleReconnect();
            }
        });
        this.ws.on('error', (err) => {
            logger.error('WebSocket error', err.message);
            // The 'close' event will fire after this, triggering reconnect
        });
    }
    scheduleReconnect() {
        logger.info(`Reconnecting in ${this.backoffMs}ms...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.establishConnection();
        }, this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    }
}
//# sourceMappingURL=connection.js.map