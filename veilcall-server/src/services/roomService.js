'use strict';

const crypto = require('crypto');
const config = require('../config');

// ── In-memory store ──────────────────────────────────────────────────────────
/** @type {Map<string, RoomState>} */
const rooms = new Map();

/** @type {Map<string, PublicRoomMeta>} */
const publicRooms = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates an 8-character uppercase alphanumeric room code.
 * Uses crypto.randomBytes for unpredictability (~41 bits of entropy).
 * Easy to read aloud and type on mobile (e.g. "A3BX92KZ").
 * @returns {string}
 */
function generateRoomCode() {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from(crypto.randomBytes(8))
        .map(b => CHARS[b % CHARS.length])
        .join('');
}

/**
 * Mints short-lived TURN credentials using the HMAC-SHA1 shared-secret scheme.
 * Compatible with Coturn's `use-auth-secret` option.
 * @returns {{ username: string, credential: string, ttl: number }}
 */
function mintTurnCredentials() {
    const ttl = 3600; // 1 hour
    const username = `${Math.floor(Date.now() / 1000) + ttl}:veilcall`;
    const hmac = crypto.createHmac('sha1', config.TURN_SECRET);
    hmac.update(username);
    const credential = hmac.digest('base64');
    return { username, credential, ttl };
}

/**
 * Tears down a room: notifies all connected peers, closes their sockets,
 * and removes the room from both maps.
 * @param {string} code
 */
function cleanupRoom(code) {
    const room = rooms.get(code);
    if (!room) return;
    room.peers.forEach((ws) => {
        try { ws.send(JSON.stringify({ type: 'room-closed' })); ws.close(); } catch { }
    });
    rooms.delete(code);
    publicRooms.delete(code);
}

// ── Public service methods ───────────────────────────────────────────────────

/**
 * Creates a new room and registers it in the store.
 * @param {{ maxParticipants?: number, expirySecs?: number, isPublic?: boolean, interests?: string[] }} opts
 * @returns {RoomState}
 */
function createRoom({ maxParticipants = 6, expirySecs, isPublic = false, interests = [] } = {}) {
    const code = generateRoomCode();
    const turnCreds = mintTurnCredentials();

    /** @type {RoomState} */
    const roomState = {
        code,
        createdAt: Date.now(),
        maxParticipants: Math.min(Number(maxParticipants) || 6, 12),
        expiresAt: expirySecs ? Date.now() + Number(expirySecs) * 1000 : null,
        peers: new Map(), // peerId -> ws
        isPublic: !!isPublic,
        interests,
        turnCreds,
    };

    rooms.set(code, roomState);

    if (isPublic) {
        publicRooms.set(code, {
            code,
            interests,
            participantCount: 0,
            maxParticipants: roomState.maxParticipants,
        });
    }

    // Auto-cleanup after expiry or 24 h
    const cleanupMs = expirySecs ? Number(expirySecs) * 1000 : 24 * 60 * 60 * 1000;
    setTimeout(() => cleanupRoom(code), cleanupMs);

    return roomState;
}

/**
 * Retrieves a room by code and validates it for joining.
 * Returns the room on success or an error descriptor on failure.
 * @param {string} code
 * @returns {{ room: RoomState } | { error: string, status: number }}
 */
function validateJoin(code) {
    const room = rooms.get(code);
    if (!room) return { error: 'Room not found or expired.', status: 404 };
    if (room.expiresAt && Date.now() > room.expiresAt) {
        cleanupRoom(code);
        return { error: 'Room has expired.', status: 410 };
    }
    if (room.peers.size >= room.maxParticipants) return { error: 'Room is full.', status: 403 };
    return { room };
}

/**
 * Returns a filtered + sorted list of joinable public rooms.
 * @param {string[]} interestFilter
 * @returns {PublicRoomMeta[]}
 */
function getPublicRooms(interestFilter = []) {
    let list = [...publicRooms.values()].filter((meta) => {
        const room = rooms.get(meta.code);
        if (!room) return false;
        if (room.expiresAt && Date.now() > room.expiresAt) return false;
        if (room.peers.size >= room.maxParticipants) return false;
        return true;
    });

    if (interestFilter.length > 0) {
        list.sort((a, b) => {
            const aScore = a.interests.filter(i => interestFilter.includes(i)).length;
            const bScore = b.interests.filter(i => interestFilter.includes(i)).length;
            return bScore - aScore;
        });
    }

    return list.slice(0, 20);
}

/**
 * Returns how many rooms are currently in the store.
 * @returns {number}
 */
function getRoomCount() {
    return rooms.size;
}

module.exports = {
    rooms,
    publicRooms,
    createRoom,
    validateJoin,
    cleanupRoom,
    getPublicRooms,
    getRoomCount,
};
