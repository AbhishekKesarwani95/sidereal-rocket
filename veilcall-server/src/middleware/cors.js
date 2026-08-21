'use strict';

const cors = require('cors');
const config = require('../config');

/**
 * CORS middleware factory.
 * Allows requests from the configured FRONTEND_URL only.
 * In development the wildcard '*' is safe; in production set FRONTEND_URL.
 */
const corsMiddleware = cors({
    origin: config.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
});

module.exports = corsMiddleware;
