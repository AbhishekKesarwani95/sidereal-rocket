'use strict';

const cors = require('cors');
const config = require('../config');

/**
 * CORS middleware.
 *
 * Logic:
 *   - If FRONTEND_URL (and optionally FRONTEND_URL_2) are set → allow only those.
 *   - If neither is set → fall back to localhost (dev mode).
 *
 * NOTE: Render does not set NODE_ENV automatically.
 * Do NOT rely on NODE_ENV to decide which origins to allow.
 */

const allowedOrigins = new Set();

const addOrigin = (url) => {
    if (url && url.trim() && url !== '*') {
        allowedOrigins.add(url.trim().replace(/\/$/, ''));
    }
};

addOrigin(config.FRONTEND_URL);
addOrigin(config.FRONTEND_URL_2);

// Only fall back to localhost when NO explicit origin is configured
if (allowedOrigins.size === 0) {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://localhost:4173');
    allowedOrigins.add('http://localhost:3000');
    console.warn('[CORS] FRONTEND_URL not set — allowing localhost only. Set FRONTEND_URL for production.');
}

console.log('[CORS] Allowed origins:', [...allowedOrigins]);

const corsMiddleware = cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true); // same-origin / server-to-server
        const normalised = origin.trim().replace(/\/$/, '');
        if (allowedOrigins.has(normalised)) return callback(null, true);
        console.warn(`[CORS] Rejected: '${origin}' | Allowed: [${[...allowedOrigins].join(', ')}]`);
        callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
});

module.exports = corsMiddleware;
