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
    // Use the rightmost trusted IP (guards against X-Forwarded-For spoofing)
    keyGenerator: (req) => getTrustedIp(req),
});

/**
 * HTTP rate limiter for GET /api/rooms/:code/join.
 * 60 attempts per IP per 5 minutes (general).
 * A stricter per-code guard lives inside the WS handler.
 */
const joinLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: config.RATE_JOIN_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many join attempts. Try again later.' },
    keyGenerator: (req) => getTrustedIp(req),
});

// ── IP extraction helper ──────────────────────────────────────────────────────
/**
 * Extracts the real client IP from the request.
 *
 * X-Forwarded-For is a comma-separated list added by each proxy hop:
 *   client, proxy1, proxy2, …, load-balancer
 * A malicious client can prepend arbitrary IPs to this header.
 * We use req.socket.remoteAddress (the address of the immediately connected
 * peer) as the authoritative source when running behind a trusted proxy.
 * In Render's case the connecting peer IS the load-balancer, so remoteAddress
 * is the LB IP. We then trust the *last* X-Forwarded-For entry added by the LB.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function getTrustedIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
        // Take the last entry — that's the one the trusted proxy added
        const parts = xff.split(',');
        return parts[parts.length - 1].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

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

module.exports = { roomCreateLimiter, joinLimiter, isWsRateLimited, getTrustedIp };
