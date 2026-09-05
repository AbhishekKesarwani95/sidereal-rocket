'use strict';

const cors = require('cors');
const config = require('../config');

/**
 * CORS middleware factory.
 * Allows requests ONLY from the configured FRONTEND_URL.
 * Throws hard in production if FRONTEND_URL is unset — never falls back to '*'.
 */

const isProd = config.NODE_ENV === 'production';

if (isProd && (!config.FRONTEND_URL || config.FRONTEND_URL === '*')) {
    throw new Error(
        '[SECURITY] FRONTEND_URL env var must be set to an explicit origin in production. ' +
        'Refusing to start with wildcard CORS.'
    );
}

// In development fall back to localhost:5173; in production must be explicit.
const allowedOrigin = config.FRONTEND_URL || 'http://localhost:5173';

const corsMiddleware = cors({
    origin(origin, callback) {
        // Allow server-to-server / curl calls with no Origin (e.g. health checks)
        if (!origin) return callback(null, true);
        if (origin === allowedOrigin) return callback(null, true);
        callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
});

module.exports = corsMiddleware;
