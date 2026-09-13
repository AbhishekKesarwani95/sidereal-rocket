'use strict';

const config = require('../config');
const roomService = require('../services/roomService');

/**
 * GET /api/health
 * Simple liveness probe.
 */
function healthCheck(req, res) {
    res.json({ status: 'ok', rooms: roomService.getRoomCount() });
}

/**
 * POST /api/rooms
 * Body: { maxParticipants?, expirySecs?, isPublic?, interests? }
 * Creates a new room and returns its code + share URL + TURN credentials.
 */
function createRoom(req, res) {
    const { maxParticipants = 6, expirySecs, isPublic = false, interests = [] } = req.body ?? {};

    // Sanitize interests: cap array length, strip non-string items, limit string length
    const safeInterests = Array.isArray(interests)
        ? interests.slice(0, 10).map(String).map(s => s.slice(0, 32).trim()).filter(Boolean)
        : [];

    const room = roomService.createRoom({ maxParticipants, expirySecs, isPublic, interests: safeInterests });

    res.status(201).json({
        code: room.code,
        shareUrl: `${config.FRONTEND_URL}/room/${room.code}`,
        turnCreds: room.turnCreds,
    });
}

/**
 * GET /api/rooms/:code/join
 * Validates that the room exists, isn't full, and hasn't expired.
 * Returns TURN credentials and current participant count on success.
 */
function joinRoom(req, res) {
    const { code } = req.params;

    // Validate room code format before hitting the Map (8 uppercase alphanum chars)
    if (!/^[A-Z0-9]{8}$/.test(code)) {
        return res.status(404).json({ error: 'Room not found or expired.' });
    }

    const result = roomService.validateJoin(code);

    if (result.error) {
        return res.status(result.status).json({ error: result.error });
    }

    const { room } = result;
    res.json({
        code: room.code,
        turnCreds: room.turnCreds,
        participantCount: room.peers.size,
    });
}

/**
 * GET /api/public-rooms?interests=tech,music
 * Returns up to 20 joinable public rooms, sorted by interest overlap.
 */
function listPublicRooms(req, res) {
    const interests = req.query.interests
        ? String(req.query.interests).split(',').filter(Boolean)
        : [];

    const rooms = roomService.getPublicRooms(interests);
    res.json({ rooms });
}

/**
 * POST /api/random-match
 * Body: { interests?: string[] }
 * Queues the caller for a 1-to-1 interest-based match.
 * Waits up to 30 s for a partner; falls back to a solo room.
 * Returns { code, turnCreds } on match.
 */
async function randomMatch(req, res) {
    const rawInterests = req.body?.interests;
    const interests = Array.isArray(rawInterests)
        ? rawInterests.slice(0, 10).map(String).map(s => s.slice(0, 32).trim()).filter(Boolean)
        : [];

    try {
        const result = await roomService.findOrCreateMatch(interests);
        res.json(result);
    } catch (err) {
        console.error('[randomMatch] error', err);
        res.status(500).json({ error: 'Matchmaking failed. Please try again.' });
    }
}

module.exports = { healthCheck, createRoom, joinRoom, listPublicRooms, randomMatch };
