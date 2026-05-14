// x402 Payment Middleware Factory
// Returns Express middleware if X402_ENABLED=true, otherwise null.

import { Logger } from '@nestjs/common';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { PAID_ROUTES } from './x402.config';
import type { RequestHandler } from 'express';

const logger = new Logger('x402');

export function createX402Middleware(): RequestHandler | null {
  if (process.env.X402_ENABLED !== 'true') {
    logger.log('x402 DISABLED — all endpoints are free');
    return null;
  }

  const payTo = process.env.X402_PAY_TO;
  if (!payTo) {
    logger.error('X402_PAY_TO not set — disabling x402');
    return null;
  }

  const network = (process.env.X402_NETWORK || 'eip155:8453') as `${string}:${string}`;
  const facilitatorUrl =
    process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';

  // Build facilitator client
  const facilitatorClient = new HTTPFacilitatorClient({
    url: facilitatorUrl,
  });

  // Build resource server with EVM scheme
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(network, new ExactEvmScheme());

  // Build routes config from our pricing map
  const routes: Record<string, any> = {};
  for (const [route, config] of Object.entries(PAID_ROUTES)) {
    routes[route] = {
      accepts: {
        scheme: 'exact' as const,
        price: config.price,
        network,
        payTo,
      },
      description: config.description,
      mimeType: 'application/json',
    };
  }

  logger.log(`x402 ENABLED — network=${network} payTo=${payTo}`);
  logger.log(`x402 facilitator: ${facilitatorUrl}`);
  for (const [route, config] of Object.entries(PAID_ROUTES)) {
    logger.log(`  PAID: ${route} → ${config.price}`);
  }

  return paymentMiddleware(routes, resourceServer) as RequestHandler;
}
