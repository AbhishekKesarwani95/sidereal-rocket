'use strict';

const cors = require('cors');
const config = require('../config');

/**
 * CORS middleware factory.
 *
 * Allowed origins built from env vars:
 *   FRONTEND_URL  — primary production origin   (required in prod)
 *   FRONTEND_URL_2 — optional second origin      (e.g. preview URL)
 *
 * In development (NODE_ENV !== 'production') localhost ports are auto-added.
 * Never falls back to '*'.
 */

const isProd = config.NODE_ENV === 'production';

// Build the allowed-origins set
const allowedOrigins = new Set();

const addOrigin = (url) => {
    if (url && url !== '*') allowedOrigins.add(url.replace(/\/$/, ''));
};

addOrigin(config.FRONTEND_URL);
addOrigin(config.FRONTEND_URL_2);

if (!isProd) {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://localhost:4173');
    allowedOrigins.add('http://localhost:3000');
}

// Hard fail in production with no explicit allowed origin
if (isProd && allowedOrigins.size === 0) {
    throw new Error(
        '[SECURITY] FRONTEND_URL env var must be set in production. ' +
        'Refusing to start with no allowed CORS origin.'
    );
}

console.log('[CORS] Allowed origins:', [...allowedOrigins]);

const corsMiddleware = cors({
    origin(origin, callback) {
        // Allow server-to-server / curl / same-origin calls with no Origin header
        if (!origin) return callback(null, true);

        const normalised = origin.replace(/\/$/, '');
        if (allowedOrigins.has(normalised)) return callback(null, true);

        console.warn(`[CORS] Rejected origin: '${origin}'. Allowed: [${[...allowedOrigins].join(', ')}]`);
        callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
});

module.exports = corsMiddleware;
