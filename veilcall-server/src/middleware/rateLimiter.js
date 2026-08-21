'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * HTTP rate limiter for POST /api/rooms (room creation).
 * 20 rooms per IP per 15 minutes.
 */
const roomCreateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.RATE_ROOM_CREATE_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many rooms created from this IP. Try again later.' },
});

/**
 * HTTP rate limiter for GET /api/rooms/:code/join.
 * 60 attempts per IP per 5 minutes.
 */
const joinLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: config.RATE_JOIN_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many join attempts. Try again later.' },
});

// ── WebSocket connection rate limiter ────────────────────────────────────────
// Simple in-memory map (intentionally NOT a dependency on express-rate-limit
// since WebSocket upgrades bypass Express middleware).
const _wsRateMap = new Map(); // ip -> { count, resetAt }

/**
 * Returns true if the given IP has exceeded the WebSocket connection rate limit.
 * Side-effect: increments the counter.
 * @param {string} ip
 * @returns {boolean}
 */
function isWsRateLimited(ip) {
    const now = Date.now();
    let entry = _wsRateMap.get(ip);
    if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + 60_000 }; // 1-minute window
        _wsRateMap.set(ip, entry);
    }
    entry.count++;
    return entry.count > config.RATE_WS_MAX_PER_MIN;
}

module.exports = { roomCreateLimiter, joinLimiter, isWsRateLimited };
