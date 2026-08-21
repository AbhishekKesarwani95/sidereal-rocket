'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const corsMiddleware = require('./middleware/cors');
const roomRoutes = require('./routes/rooms');

// Resolved path to the Vite production build
const DIST_DIR = path.resolve(__dirname, '../../veilcall-frontend/dist');
const DIST_EXISTS = fs.existsSync(DIST_DIR);

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

    // ── Serve built frontend (production) ────────────────────────────────────
    if (DIST_EXISTS) {
        app.use(express.static(DIST_DIR));
        // SPA fallback: any unknown path returns index.html so React Router works
        app.get('*', (req, res) => {
            res.sendFile(path.join(DIST_DIR, 'index.html'));
        });
    } else {
        // Dev mode: no dist folder yet — return 404 for unknown paths
        app.use((req, res) => {
            res.status(404).json({ error: 'Not found' });
        });
    }

    // ── Global error handler ─────────────────────────────────────────────────
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => {
        console.error('[Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    });

    return app;
}

module.exports = { createApp };
