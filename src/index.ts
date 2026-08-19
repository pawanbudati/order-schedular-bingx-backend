import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import apiRouter from './routes/api.js';
import { schedulerEngine } from './scheduler/engine.js';
import { bingxWebSocket } from './bingx/websocket.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8445;

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-BX-APIKEY'],
  })
);
app.use(express.json());

// API routes (support /api and /bingx-api prefixes)
app.use('/api', apiRouter);
app.use('/bingx-api', apiRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  res.json({
    status: 'ok',
    engine: 'BingX Ultra-Low Latency Scheduler Engine',
    timeIST: istTime,
    timestamp: Date.now(),
  });
});

// Serve frontend dist statically if available
const frontendDist = path.resolve(process.cwd(), '../order-schedular-bingx/dist');
const frontendDistLocal = path.resolve(process.cwd(), './dist_frontend');

const staticDir = fs.existsSync(frontendDist)
  ? frontendDist
  : fs.existsSync(frontendDistLocal)
  ? frontendDistLocal
  : null;

if (staticDir) {
  console.log(`📁 Serving frontend static dist from: ${staticDir}`);
  app.use(
    express.static(staticDir, {
      setHeaders: (res, filepath) => {
        if (filepath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
      },
    })
  );
}

// Fallback API routes on root
app.use('/', apiRouter);

// Start server & engines
async function startServer() {
  // 1. Initialize BingX WebSocket ticker stream
  bingxWebSocket.connect();

  // 2. Initialize High-Precision Scheduler Engine
  await schedulerEngine.init();

  const host = '0.0.0.0';
  app.listen(Number(PORT), host, () => {
    console.log(`⚡ High-Precision BingX Order Scheduler Server running on http://${host}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting BingX Scheduler server:', err);
});
