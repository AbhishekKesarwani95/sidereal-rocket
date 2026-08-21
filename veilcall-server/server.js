require('dotenv').config();

const http = require('http');
const config = require('./src/config');
const { createApp } = require('./src/app');
const { attachSignaling } = require('./src/websocket/signaling');

// Create HTTP server from the Express app
const app = createApp();
const server = http.createServer(app);

// Attach WebSocket signaling to the same HTTP server
attachSignaling(server);

// Start listening
server.listen(config.PORT, () => {
    console.log(`✅ Veilcall signaling server running on port ${config.PORT}`);
    console.log(`   CORS origin : ${config.FRONTEND_URL}`);
    console.log(`   Environment : ${config.NODE_ENV}`);
});
