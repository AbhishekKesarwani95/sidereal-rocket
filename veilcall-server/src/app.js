'use strict';

const express = require('express');
const corsMiddleware = require('./middleware/cors');
const roomRoutes = require('./routes/rooms');

/**
 * Creates and configures the Express application.
 * Exported as a factory so it can be imported by tests without starting a server.
 * @returns {import('express').Application}
 */
function createApp() {
    const app = express();

    // ── Global middleware ────────────────────────────────────────────────────
    app.use(corsMiddleware);
    app.use(express.json());

    // ── Routes ───────────────────────────────────────────────────────────────
    app.use('/api', roomRoutes);

    // ── 404 catch-all ────────────────────────────────────────────────────────
    app.use((req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    // ── Global error handler ─────────────────────────────────────────────────
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => {
        console.error('[Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    });

    return app;
}

module.exports = { createApp };
