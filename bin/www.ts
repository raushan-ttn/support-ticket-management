#!/usr/bin/env node

import app from '../src/app';
import debug from 'debug';
import http from 'http';
import config from '../src/config';
import { connectPostgres, disconnectPostgres } from '../src/config/postgres';
import { connectRedis, disconnectRedis } from '../src/config/redis';

const serverDebug = debug('backend-node:server');
const port = config.port;
app.set('port', port);

const server = http.createServer(app);

async function bootstrap(): Promise<void> {
  await connectPostgres();
  await connectRedis();

  server.listen(port);
  server.on('error', onError);
  server.on('listening', onListening);
}

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Server] ${signal} received — shutting down gracefully`);
  server.close(async () => {
    await disconnectPostgres();
    await disconnectRedis();
    console.log('[Server] Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});

function onError(error: NodeJS.ErrnoException): void {
  if (error.syscall !== 'listen') throw error;
  const bind = typeof port === 'string' ? `Pipe ${port}` : `Port ${port}`;
  switch (error.code) {
    case 'EACCES':
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
}

function onListening(): void {
  const addr = server.address();
  const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr?.port}`;
  serverDebug(`Listening on ${bind}`);
  console.log(`[Server] Running on http://localhost:${port}`);
}
