'use strict';

const cors = require('cors');
const config = require('../config');

/**
 * CORS middleware factory.
 *
 * Allowed origins (in priority order):
 *   1. FRONTEND_URL env var  — explicit production URL (required in prod)
 *   2. FRONTEND_URL_2 env var — optional second origin (e.g. preview URL)
 *   3. localhost:5173 / localhost:4173 / localhost:3000 — dev fallback
 *
 * Never falls back to '*' in production.
 */

const isProd = config.NODE_ENV === 'production';

// Build the allowed-origins set
const allowedOrigins = new Set();

if (config.FRONTEND_URL && config.FRONTEND_URL !== '*') {
    allowedOrigins.add(config.FRONTEND_URL.replace(/\/$/, '')); // strip trailing slash
}

if (config.FRONTEND_URL_2 && config.FRONTEND_URL_2 !== '*') {
    allowedOrigins.add(config.FRONTEND_URL_2.replace(/\/$/, ''));
}

if (!isProd) {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://localhost:4173');
    allowedOrigins.add('http://localhost:3000');
}

// Hard fail in production with no explicit allowed origin
if (isProd && allowedOrigins.size === 0) {
    throw new Error(
        '[SECURITY] FRONTEND_URL env var must be set to an explicit origin in production. ' +
        'Refusing to start with no allowed CORS origin.'
    );
}

console.log('[CORS] Allowed origins:', [...allowedOrigins]);

const corsMiddleware = cors({
    origin(origin, callback) {
        // Allow server-to-server / curl calls with no Origin (e.g. health checks)
        if (!origin) return callback(null, true);

        const normalised = origin.replace(/\/$/, '');
        if (allowedOrigins.has(normalised)) return callback(null, true);

        callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
});

module.exports = corsMiddleware;
