import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ArenaPersistenceService } from './arena/arena-persistence.service';
import { createX402Middleware } from './x402/x402.setup';
import { getAllowedOrigins } from './config/origins.config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = getAllowedOrigins();
  app.enableCors({
    origin: allowedOrigins,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Payment', 'X-Payment-Response'],
    exposedHeaders: ['X-Payment', 'X-Payment-Response'],
  });

  // x402 payment middleware (before NestJS routing)
  const x402 = createX402Middleware();
  if (x402) {
    app.use(x402);
  }

  // Graceful shutdown: flush persistence before dying
  app.enableShutdownHooks();

  const shutdownHandler = async (signal: string) => {
    logger.warn(`Received ${signal}. Starting graceful shutdown...`);
    try {
      const persistence = app.get(ArenaPersistenceService);
      await persistence.flushToDisk();
      logger.log('Persistence flushed to disk');
    } catch (err) {
      logger.error('Failed to flush persistence during shutdown', err);
    }
    // NestJS shutdown hooks handle the rest (close server, disconnect sockets)
  };

  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));

  const port = process.env.PORT || 3001;
  await app.listen(port);

  logger.log(`Game server running on http://localhost:${port}`);
  logger.log(`WebSocket available on ws://localhost:${port}`);
}

bootstrap();
