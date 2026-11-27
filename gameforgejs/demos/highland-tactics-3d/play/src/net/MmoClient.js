/**
 * Client side of the Highland MMO protocol (see GameForgeJS.OnlineServer/mmo). JSON text frames
 * over one WebSocket: requests carry an `id` that the server copies into `re`; anything without
 * `re` is a push (presence, chat, kicked). No engine imports, so it is testable in Node.
 */

import { MmoError } from './MmoError.js';

export { MmoError };

export const NetworkModes = Object.freeze(['offline', 'lan', 'online']);
export const ProtocolVersion = 1;

/** The `network` section of config/game.config.json, with defaults for anything missing. */
export function NetworkConfig(config) {
    const network = config?.network ?? {};
    return {
        mode: NetworkModes.includes(network.mode) ? network.mode : 'offline',
        lanPort: Number.isInteger(network.lanPort) && network.lanPort > 0 && network.lanPort < 65536 ? network.lanPort : 7878,
        onlineUrl: typeof network.onlineUrl === 'string' ? network.onlineUrl : '',
    };
}

/** The address a mode starts with: LAN guesses the page's own host, Online uses the configured URL. */
export function DefaultServerUrl(mode, network, location = globalThis.location) {
    if (mode === 'lan') {
        const host = location?.protocol?.startsWith('http') && location.hostname ? location.hostname : '127.0.0.1';
        return `ws://${host}:${network.lanPort}/mmo`;
    }
    return mode === 'online' ? network.onlineUrl : '';
}

/**
 * Turns what the player typed into a WebSocket URL: adds `ws://` (or `wss://` on HTTPS pages)
 * and the `/mmo` path when they are missing. Throws a readable Error for anything unusable,
 * including a `ws://` address from an HTTPS page, which browsers block.
 */
export function NormalizeServerUrl(text, location = globalThis.location) {
    let value = String(text ?? '').trim();
    if (!value) throw new Error('Enter a server address.');
    const secure = location?.protocol === 'https:';
    if (!/^[a-z]+:\/\//i.test(value)) value = `${secure ? 'wss' : 'ws'}://${value}`;
    let url;
    try { url = new URL(value); }
    catch { throw new Error('That server address is not valid.'); }
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Use a ws:// or wss:// address.');
    if (secure && url.protocol === 'ws:') throw new Error('This page is HTTPS, so it can only reach wss:// servers.');
    if (url.pathname === '/' || !url.pathname) url.pathname = '/mmo';
    return url.toString();
}

/** One connection to an MMO server: request/response by id, pushes by type, and a status. */
export class MmoClient {
    constructor(url, { WebSocketImpl = globalThis.WebSocket, timeout = 8000 } = {}) {
        if (!WebSocketImpl) throw new MmoError('This browser has no WebSocket support.');
        this.url = url;
        this.WebSocketImpl = WebSocketImpl;
        this.timeout = timeout;
        this.status = 'idle';
        this.socket = null;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
    }

    /** Opens the socket and resolves once the server says hello. */
    Connect() {
        if (this.status === 'open') return Promise.resolve(this);
        this.status = 'connecting';
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = message => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.status = 'closed';
                try { this.socket?.close(); } catch { /* already closed */ }
                reject(new MmoError(message));
            };
            const timer = setTimeout(() => fail(`No answer from ${this.url}.`), this.timeout);
            try { this.socket = new this.WebSocketImpl(this.url); }
            catch (error) { fail(`Cannot reach ${this.url}: ${error.message}`); return; }
            this.socket.onmessage = event => {
                let message;
                try { message = JSON.parse(String(event.data)); }
                catch { return; }
                if (!settled && message?.t === 'hello') {
                    settled = true;
                    clearTimeout(timer);
                    if (message.version !== ProtocolVersion) {
                        this.status = 'closed';
                        this.socket.close();
                        reject(new MmoError(`Server protocol ${message.version} does not match this game (${ProtocolVersion}).`));
                        return;
                    }
                    this.status = 'open';
                    resolve(this);
                    return;
                }
                this.Receive(message);
            };
            this.socket.onerror = () => fail(`Cannot reach ${this.url}.`);
            this.socket.onclose = () => {
                if (!settled) { fail(`Cannot reach ${this.url}.`); return; }
                this.Closed('The connection to the server closed.');
            };
        });
    }

    Receive(message) {
        if (!message || typeof message.t !== 'string') return;
        if (message.re !== undefined && message.re !== null && this.pending.has(message.re)) {
            const request = this.pending.get(message.re);
            this.pending.delete(message.re);
            clearTimeout(request.timer);
            if (message.t === 'error') request.reject(new MmoError(message.error ?? 'Server error.', message.for));
            else request.resolve(message);
            return;
        }
        this.Emit(message.t, message);
    }

    /** Sends `{t, ...payload}` and resolves with the reply, or rejects with an MmoError. */
    Request(t, payload = {}) {
        if (this.status !== 'open') return Promise.reject(new MmoError('Not connected to a server.'));
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new MmoError('The server did not answer in time.', t));
            }, this.timeout);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(JSON.stringify({ ...payload, t, id }));
        });
    }

    /** Subscribes to a push type (or 'close'); returns the unsubscribe function. */
    On(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
        return () => this.listeners.get(type)?.delete(listener);
    }

    Emit(type, message) {
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener(message);
    }

    Closed(reason) {
        if (this.status === 'closed') return;
        this.status = 'closed';
        for (const request of this.pending.values()) {
            clearTimeout(request.timer);
            request.reject(new MmoError(reason));
        }
        this.pending.clear();
        this.Emit('close', { reason });
    }

    Close() {
        try { this.socket?.close(); } catch { /* already closed */ }
        this.Closed('Signed out.');
    }
}

/**
 * The signed-in session outlives scene changes (every zone and battle is a new level), so it
 * lives here rather than on a level. `null` means Offline.
 */
let current = null;

export function ActiveSession() {
    return current?.client.status === 'open' ? current : null;
}

export function StartSession({ client, account, token, mode }) {
    current = { client, account, token, mode };
    client.On('close', () => { if (current?.client === client) current = null; });
    return current;
}

export function EndSession() {
    const session = current;
    current = null;
    session?.client.Close();
}
