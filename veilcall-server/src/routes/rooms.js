'use strict';

const { Router } = require('express');
const { roomCreateLimiter, joinLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/roomController');

const router = Router();

/**
 * Route definitions – no logic lives here.
 * Each line maps: METHOD + path → [optional middleware] → controller function
 */
router.get('/health', ctrl.healthCheck);
router.post('/rooms', roomCreateLimiter, ctrl.createRoom);
router.get('/rooms/:code/join', joinLimiter, ctrl.joinRoom);
router.get('/public-rooms', ctrl.listPublicRooms);
router.post('/random-match', joinLimiter, ctrl.randomMatch);

module.exports = router;
