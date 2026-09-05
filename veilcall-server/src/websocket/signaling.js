'use strict';

const { WebSocketServer } = require('ws');
const { isWsRateLimited, getTrustedIp } = require('../middleware/rateLimiter');
const roomService = require('../services/roomService');
const config = require('../config');

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum incoming WebSocket message size in bytes (64 KB). */
const WS_MAX_MESSAGE_BYTES = 64 * 1024;

/** UUID v4 regex for peerId validation. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Message types this server is willing to relay. Anything else is silently dropped. */
const ALLOWED_TYPES = new Set(['offer', 'answer', 'ice-candidate', 'key-material', 'chat', 'peer-meta']);

/**
 * Fields allowed in relayed envelopes per message type.
 * We reconstruct the envelope from known fields only — never blindly spread client JSON.
 */
const TYPE_ALLOWED_FIELDS = {
    offer: ['type', 'payload'],
    answer: ['type', 'payload'],
    'ice-candidate': ['type', 'payload'],
    'key-material': ['type', 'payload'],
    chat: ['type', 'payload'],
    'peer-meta': ['type', 'payload'],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Broadcasts a message to every peer in the room except the sender.
 * @param {import('../services/roomService').RoomState} room
 * @param {string} fromPeerId
 * @param {object} message
 */
function broadcast(room, fromPeerId, message) {
    const payload = JSON.stringify(message);
    room.peers.forEach((ws, peerId) => {
        if (peerId !== fromPeerId && ws.readyState === 1 /* OPEN */) {
            ws.send(payload);
        }
    });
}

/**
 * Sends a message to a single peer.
 * @param {import('../services/roomService').RoomState} room
 * @param {string} toPeerId
 * @param {object} message
 */
function sendTo(room, toPeerId, message) {
    const ws = room.peers.get(toPeerId);
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(message));
    }
}

/**
 * Validates and sanitizes an incoming signaling payload.
 * Returns a clean envelope or null if the message should be dropped.
 * @param {unknown} raw
 * @param {string} fromPeerId
 * @returns {{ type: string; to?: string; payload?: unknown; from: string } | null}
 */
function sanitizeMessage(raw, fromPeerId) {
    if (!raw || typeof raw !== 'object') return null;
    const msg = /** @type {Record<string,unknown>} */ (raw);

    const type = msg.type;
    if (typeof type !== 'string' || !ALLOWED_TYPES.has(type)) return null;

    // Validate optional `to` field — must be a UUID if present
    const to = msg.to;
    if (to !== undefined) {
        if (typeof to !== 'string' || !UUID_RE.test(to)) return null;
    }

    // Validate chat text length server-side (mirrors frontend maxLength=500)
    if (type === 'chat') {
        const p = msg.payload;
        if (p && typeof p === 'object') {
            const text = p.text;
            if (typeof text === 'string' && text.length > 500) return null;
        }
    }

    // Build clean envelope from known-safe fields only
    const allowedFields = TYPE_ALLOWED_FIELDS[type] ?? ['type', 'payload'];
    const envelope = { from: fromPeerId };
    for (const field of allowedFields) {
        if (field in msg) envelope[field] = msg[field];
    }
    if (to) envelope.to = to;

    return envelope;
}

// ── Connection handler ───────────────────────────────────────────────────────

/**
 * Handles a single WebSocket connection lifecycle:
 * authenticate → join room → relay messages → handle disconnect.
 * @param {import('ws').WebSocket} ws
 * @param {import('http').IncomingMessage} req
 */
function handleConnection(ws, req) {
    // ── Origin check (CORS doesn't apply to WS upgrades) ─────────────────────
    const origin = req.headers['origin'];
    const allowedOrigin = config.FRONTEND_URL || 'http://localhost:5173';
    if (origin && origin !== allowedOrigin) {
        ws.close(1008, 'Origin not allowed');
        return;
    }

    // ── Rate limit ────────────────────────────────────────────────────────────
    const ip = getTrustedIp(req);
    if (isWsRateLimited(ip)) {
        ws.close(1008, 'Rate limited');
        return;
    }

    // ── Parse + validate query parameters ────────────────────────────────────
    const url = new URL(req.url, 'http://localhost');
    const roomCode = url.searchParams.get('room');
    const rawPeerId = url.searchParams.get('peer');

    // Enforce UUID v4 format for peerId — reject arbitrary strings
    const peerId = rawPeerId && UUID_RE.test(rawPeerId)
        ? rawPeerId
        : require('crypto').randomUUID();

    // ── Validate room ─────────────────────────────────────────────────────────
    const { rooms, publicRooms, cleanupRoom } = roomService;
    const room = rooms.get(roomCode);
    if (!room) { ws.close(4004, 'Room not found'); return; }
    if (room.expiresAt && Date.now() > room.expiresAt) { ws.close(4010, 'Room expired'); return; }
    if (room.peers.size >= room.maxParticipants) { ws.close(4003, 'Room full'); return; }

    // ── Register peer ─────────────────────────────────────────────────────────
    room.peers.set(peerId, ws);
    if (publicRooms.has(roomCode)) {
        publicRooms.get(roomCode).participantCount = room.peers.size;
    }

    // Notify the new peer of all current members
    ws.send(JSON.stringify({
        type: 'room-joined',
        peerId,
        peers: [...room.peers.keys()].filter(id => id !== peerId),
        participantCount: room.peers.size,
    }));

    // Notify existing peers
    broadcast(room, peerId, { type: 'peer-joined', from: peerId, peerId });

    // ── Message relay ─────────────────────────────────────────────────────────
    ws.on('message', (data) => {
        // ── Size guard — reject oversized messages (DoS prevention) ──────────
        const byteLen = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data));
        if (byteLen > WS_MAX_MESSAGE_BYTES) {
            ws.close(1009, 'Message too large');
            return;
        }

        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        // ── Sanitize + whitelist fields ────────────────────────────────────────
        const envelope = sanitizeMessage(msg, peerId);
        if (!envelope) return;

        if (envelope.to) {
            sendTo(room, String(envelope.to), envelope);   // unicast
        } else {
            broadcast(room, peerId, envelope);              // multicast
        }
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    ws.on('close', () => {
        room.peers.delete(peerId);
        if (publicRooms.has(roomCode)) {
            publicRooms.get(roomCode).participantCount = room.peers.size;
        }
        broadcast(room, peerId, { type: 'peer-left', from: peerId, peerId });

        // Auto-cleanup if room is empty (30 s grace period for last peer to rejoin)
        if (room.peers.size === 0) {
            setTimeout(() => {
                if (rooms.has(roomCode) && rooms.get(roomCode).peers.size === 0) {
                    cleanupRoom(roomCode);
                }
            }, 30_000);
        }
    });

    ws.on('error', () => { /* suppress unhandled error events */ });
}

// ── Public factory ───────────────────────────────────────────────────────────

/**
 * Attaches the WebSocket signaling server to an existing HTTP server.
 * @param {import('http').Server} httpServer
 * @returns {import('ws').WebSocketServer}
 */
function attachSignaling(httpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    wss.on('connection', handleConnection);
    return wss;
}

module.exports = { attachSignaling };
