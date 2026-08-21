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

    const room = roomService.createRoom({ maxParticipants, expirySecs, isPublic, interests });

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

module.exports = { healthCheck, createRoom, joinRoom, listPublicRooms };
