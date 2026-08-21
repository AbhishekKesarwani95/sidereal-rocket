'use strict';

const { WebSocketServer } = require('ws');
const { isWsRateLimited } = require('../middleware/rateLimiter');
const roomService = require('../services/roomService');

// ── Low-level helpers ────────────────────────────────────────────────────────

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

// ── Connection handler ───────────────────────────────────────────────────────

/** Message types this server is willing to relay. Anything else is silently dropped. */
const ALLOWED_TYPES = new Set(['offer', 'answer', 'ice-candidate', 'key-material', 'chat', 'peer-meta']);

/**
 * Handles a single WebSocket connection lifecycle:
 * authenticate → join room → relay messages → handle disconnect.
 * @param {import('ws').WebSocket} ws
 * @param {import('http').IncomingMessage} req
 */
function handleConnection(ws, req) {
    // ── Rate limit ────────────────────────────────────────────────────────────
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (isWsRateLimited(ip)) {
        ws.close(1008, 'Rate limited');
        return;
    }

    // ── Parse query parameters ────────────────────────────────────────────────
    const url = new URL(req.url, 'http://localhost');
    const roomCode = url.searchParams.get('room');
    const peerId = url.searchParams.get('peer') || require('crypto').randomUUID();

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
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (!ALLOWED_TYPES.has(msg.type)) return; // whitelist enforcement

        const envelope = { ...msg, from: peerId };
        if (msg.to) {
            sendTo(room, msg.to, envelope);   // unicast
        } else {
            broadcast(room, peerId, envelope); // multicast
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
