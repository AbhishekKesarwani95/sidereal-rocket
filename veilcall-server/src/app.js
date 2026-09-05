'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const corsMiddleware = require('./middleware/cors');
const roomRoutes = require('./routes/rooms');
const config = require('./config');

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

    // ── Security headers (Helmet) ─────────────────────────────────────────────
    app.use(helmet({
        // Content-Security-Policy: lock down resource origins
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'wasm-unsafe-eval'"],          // wasm needed for MediaPipe
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'blob:'],
                mediaSrc: ["'self'", 'blob:'],
                connectSrc: [
                    "'self'",
                    'wss:',                                                  // WebSocket signaling
                    'https://cdn.jsdelivr.net',                              // MediaPipe WASM
                    'https://storage.googleapis.com',                        // MediaPipe model
                    ...(config.FRONTEND_URL ? [config.FRONTEND_URL] : []),
                ],
                workerSrc: ["'self'", 'blob:'],
                fontSrc: ["'self'", 'https://fonts.gstatic.com'],
                frameSrc: ["'none'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
            },
        },
        // HSTS: 2 years, include subdomains
        strictTransportSecurity: {
            maxAge: 63072000,
            includeSubDomains: true,
        },
        // Prevent MIME-type sniffing
        xContentTypeOptions: true,
        // Deny framing (click-jacking)
        xFrameOptions: { action: 'deny' },
        // No referrer on cross-origin navigation
        referrerPolicy: { policy: 'no-referrer' },
        // Disable X-Powered-By (hides Express)
        hidePoweredBy: true,
        // Permissions policy: camera + mic restricted to self
        permittedCrossDomainPolicies: false,
    }));

    // Permissions-Policy header (Helmet doesn't cover this yet)
    app.use((_req, res, next) => {
        res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
        next();
    });

    // ── Global middleware ────────────────────────────────────────────────────
    app.use(corsMiddleware);
    app.use(express.json({ limit: '16kb' })); // cap request body size

    // ── Routes ───────────────────────────────────────────────────────────────
    app.use('/api', roomRoutes);

    // ── Serve built frontend (production) ────────────────────────────────────
    if (DIST_EXISTS) {
        app.use(express.static(DIST_DIR, {
            // Never cache index.html — always fetch fresh for SPA routing
            setHeaders(res, filePath) {
                if (filePath.endsWith('index.html')) {
                    res.setHeader('Cache-Control', 'no-store');
                }
            },
        }));
        // SPA fallback: any unknown path returns index.html so React Router works
        app.get('/{*path}', (req, res) => {
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
