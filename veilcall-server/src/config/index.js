'use strict';

/**
 * Central configuration object.
 * All environment variables are read exactly once here so every module
 * imports from one source of truth instead of scattering process.env calls.
 */
const config = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '3001', 10),

    /** Allowed CORS origin for REST + WS connections */
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

    /** Shared secret used to mint short-lived TURN credentials (RFC 8489 §9.1) */
    TURN_SECRET: process.env.TURN_SECRET || 'veilcall-dev-secret',

    /** TURN server hostname (optional – leave blank to skip TURN) */
    TURN_HOST: process.env.TURN_HOST || '',

    /** TURN port (defaults to standard 3478) */
    TURN_PORT: parseInt(process.env.TURN_PORT || '3478', 10),

    // ── Rate-limit defaults ──────────────────────────────────────────────────
    RATE_ROOM_CREATE_MAX: 20,   // per 15 min window
    RATE_JOIN_MAX: 60,   // per 5 min window
    RATE_WS_MAX_PER_MIN: 30,   // WebSocket connects per minute per IP
};

module.exports = config;
