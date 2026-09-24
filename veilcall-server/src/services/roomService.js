'use strict';

const crypto = require('crypto');
const config = require('../config');

// ── Security guard ───────────────────────────────────────────────────────────
if (config.NODE_ENV === 'production' && config.TURN_SECRET === 'veilcall-dev-secret') {
    throw new Error(
        '[SECURITY] TURN_SECRET is still the insecure default value. ' +
        'Set a strong TURN_SECRET env var before deploying to production.'
    );
}

// ── In-memory store ──────────────────────────────────────────────────────────
/** @type {Map<string, RoomState>} */
const rooms = new Map();

/** @type {Map<string, PublicRoomMeta>} */
const publicRooms = new Map();

// ── Matchmaking queue for random 1-to-1 calls ───────────────────────────────
/**
 * @typedef {{ interests: string[], resolve: (code: string) => void, reject: (err: Error) => void, timer: ReturnType<typeof setTimeout> }} QueueEntry
 */
/** @type {QueueEntry[]} */
const matchQueue = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates an 8-character uppercase alphanumeric room code.
 * Uses crypto.randomBytes for unpredictability (~41 bits of entropy).
 * @returns {string}
 */
function generateRoomCode() {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const CHARS_LEN = CHARS.length;           // 36
    // Rejection-sampling: discard bytes >= 252 to eliminate modulo bias.
    // 252 = floor(256/36)*36 — any byte in [0,252) maps uniformly to one of 36 chars.
    const LIMIT = Math.floor(256 / CHARS_LEN) * CHARS_LEN; // 252
    const code = [];
    while (code.length < 8) {
        const batch = Array.from(crypto.randomBytes(16));
        for (const b of batch) {
            if (b >= LIMIT) continue; // reject biased tail
            code.push(CHARS[b % CHARS_LEN]);
            if (code.length === 8) break;
        }
    }
    return code.join('');
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
    // Close approved peers
    room.peers.forEach((ws) => {
        try { ws.send(JSON.stringify({ type: 'room-closed' })); ws.close(); } catch { }
    });
    // Close pending peers
    if (room.pendingPeers) {
        room.pendingPeers.forEach((ws) => {
            try { ws.send(JSON.stringify({ type: 'room-closed' })); ws.close(); } catch { }
        });
    }
    rooms.delete(code);
    publicRooms.delete(code);
}

/**
 * Calculates interest overlap score between two arrays.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
function interestOverlap(a, b) {
    if (!a.length || !b.length) return 0;
    const setB = new Set(b.map(s => s.toLowerCase()));
    return a.filter(i => setB.has(i.toLowerCase())).length;
}

// ── Public service methods ───────────────────────────────────────────────────

/**
 * Creates a new room and registers it in the store.
 * @param {{ maxParticipants?: number, expirySecs?: number, isPublic?: boolean, interests?: string[], waitingRoom?: boolean }} opts
 * @returns {RoomState}
 */
function createRoom({ maxParticipants = 6, expirySecs, isPublic = false, interests = [], waitingRoom = false } = {}) {
    const code = generateRoomCode();
    const turnCreds = mintTurnCredentials();

    /** @type {RoomState} */
    const roomState = {
        code,
        createdAt: Date.now(),
        maxParticipants: Math.min(Number(maxParticipants) || 6, 12),
        expiresAt: expirySecs ? Date.now() + Number(expirySecs) * 1000 : null,
        peers: new Map(),           // peerId -> ws (approved peers)
        pendingPeers: new Map(),    // peerId -> ws (waiting for host approval)
        isPublic: !!isPublic,
        interests,
        turnCreds,
        waitingRoom: !!waitingRoom,
        hostPeerId: null,           // first peer to join becomes host
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

// ── Random 1-to-1 Matchmaking ────────────────────────────────────────────────

/**
 * Finds a match for a random 1-to-1 call.
 * Returns a Promise that resolves with the room code when matched.
 *
 * Algorithm:
 * 1. Search the queue for someone with interest overlap → match immediately
 * 2. If no overlap match, take the oldest person in queue (fallback)
 * 3. If queue empty, add to queue and wait up to 30s for a partner
 * 4. If 30s timeout, create a solo public room and return it (next person will join)
 *
 * @param {string[]} interests
 * @returns {Promise<{ code: string, turnCreds: object }>}
 */
function findOrCreateMatch(interests = []) {
    return new Promise((resolve, reject) => {
        // ── Step 1 & 2: Try to match someone already in the queue ─────────
        let bestIdx = -1;
        let bestScore = -1;

        for (let i = 0; i < matchQueue.length; i++) {
            const entry = matchQueue[i];
            const score = interestOverlap(interests, entry.interests);
            if (score > bestScore) {
                bestScore = score;
                bestIdx = i;
            }
        }

        // If no interest overlap at all, still take the oldest person (fallback)
        if (bestIdx === -1 && matchQueue.length > 0) {
            bestIdx = 0;
            bestScore = 0;
        }

        if (bestIdx >= 0) {
            // Found a match! Pop them from the queue
            const [partner] = matchQueue.splice(bestIdx, 1);
            clearTimeout(partner.timer);

            // Create a private 1-to-1 room
            const room = createRoom({
                maxParticipants: 2,
                expirySecs: 3600,    // 1 hour
                isPublic: false,
                interests: [...new Set([...interests, ...partner.interests])],
                waitingRoom: false,
            });

            // Resolve both the partner's promise and ours
            partner.resolve(room.code);
            resolve({ code: room.code, turnCreds: room.turnCreds });
            return;
        }

        // ── Step 3: Queue empty — wait for someone else ───────────────────
        const timer = setTimeout(() => {
            // Remove ourselves from queue
            const idx = matchQueue.findIndex(e => e.resolve === resolve);
            if (idx >= 0) matchQueue.splice(idx, 1);

            // Step 4: Create a solo public room so the next searcher can find us
            const room = createRoom({
                maxParticipants: 2,
                expirySecs: 300,     // 5 min expiry for solo room
                isPublic: true,
                interests,
                waitingRoom: false,
            });
            resolve({ code: room.code, turnCreds: room.turnCreds });
        }, 30_000); // 30 second wait

        matchQueue.push({
            interests, resolve: (code) => {
                const room = rooms.get(code);
                resolve({ code, turnCreds: room ? room.turnCreds : mintTurnCredentials() });
            }, reject, timer
        });
    });
}

/**
 * Moves a peer from pendingPeers to peers (host approved them).
 * @param {string} roomCode
 * @param {string} peerId
 * @returns {import('ws').WebSocket | null} The WebSocket of the admitted peer, or null
 */
function admitPeer(roomCode, peerId) {
    const room = rooms.get(roomCode);
    if (!room) return null;
    const ws = room.pendingPeers.get(peerId);
    if (!ws) return null;
    room.pendingPeers.delete(peerId);
    room.peers.set(peerId, ws);
    if (publicRooms.has(roomCode)) {
        publicRooms.get(roomCode).participantCount = room.peers.size;
    }
    return ws;
}

/**
 * Rejects a pending peer (host rejected them).
 * @param {string} roomCode
 * @param {string} peerId
 * @returns {import('ws').WebSocket | null}
 */
function rejectPendingPeer(roomCode, peerId) {
    const room = rooms.get(roomCode);
    if (!room) return null;
    const ws = room.pendingPeers.get(peerId);
    if (!ws) return null;
    room.pendingPeers.delete(peerId);
    return ws;
}

module.exports = {
    rooms,
    publicRooms,
    createRoom,
    validateJoin,
    cleanupRoom,
    getPublicRooms,
    getRoomCount,
    findOrCreateMatch,
    admitPeer,
    rejectPendingPeer,
};
