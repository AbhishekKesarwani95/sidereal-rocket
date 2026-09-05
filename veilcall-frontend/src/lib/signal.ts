// Signaling server WebSocket message types and protocol helpers

export type SignalMessageType =
    | 'room-joined'
    | 'room-closed'
    | 'peer-joined'
    | 'peer-left'
    | 'offer'
    | 'answer'
    | 'ice-candidate'
    | 'key-material'
    | 'chat'
    | 'peer-meta';

export interface SignalMessage {
    type: SignalMessageType;
    from?: string;
    to?: string;
    payload?: unknown;
    // room-joined fields
    peerId?: string;
    peers?: string[];
    participantCount?: number;
}

export class SignalingClient {
    private ws: WebSocket | null = null;
    private roomCode: string;
    private peerId: string;
    private handlers = new Map<string, ((msg: SignalMessage) => void)[]>();
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private pingTimer: ReturnType<typeof setInterval> | null = null;
    private shouldReconnect = true;
    private serverUrl: string;

    constructor(serverUrl: string, roomCode: string, peerId: string) {
        this.serverUrl = serverUrl;
        this.roomCode = roomCode;
        this.peerId = peerId;
    }

    connect() {
        this.shouldReconnect = true;
        this._connect();
    }

    private _connect() {
        if (this.ws) { try { this.ws.close(); } catch { } }
        const url = `${this.serverUrl}/ws?room=${this.roomCode}&peer=${this.peerId}`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            this._emit('connected', { type: 'connected' } as unknown as SignalMessage);
            // Bug 4 fix: keepalive ping every 20 s to prevent NAT/carrier teardown
            if (this.pingTimer) clearInterval(this.pingTimer);
            this.pingTimer = setInterval(() => {
                if (this.ws?.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 20_000);
        };

        this.ws.onmessage = (e) => {
            try {
                const msg: SignalMessage = JSON.parse(e.data);
                this._emit(msg.type, msg);
                this._emit('*', msg);
            } catch { }
        };

        this.ws.onclose = () => {
            if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
            this._emit('disconnected', { type: 'room-closed' } as SignalMessage);
            if (this.shouldReconnect) {
                this.reconnectTimer = setTimeout(() => this._connect(), 2000);
            }
        };

        this.ws.onerror = () => { };
    }

    send(msg: Omit<SignalMessage, 'from'>) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    sendTo(to: string, msg: Omit<SignalMessage, 'from'>) {
        this.send({ ...msg, to });
    }

    on(type: string, handler: (msg: SignalMessage) => void) {
        const list = this.handlers.get(type) ?? [];
        list.push(handler);
        this.handlers.set(type, list);
        return () => this.off(type, handler);
    }

    off(type: string, handler: (msg: SignalMessage) => void) {
        const list = this.handlers.get(type) ?? [];
        this.handlers.set(type, list.filter(h => h !== handler));
    }

    private _emit(type: string, msg: SignalMessage) {
        (this.handlers.get(type) ?? []).forEach(h => h(msg));
    }

    disconnect() {
        this.shouldReconnect = false;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
        this.ws?.close();
        this.ws = null;
    }
}
