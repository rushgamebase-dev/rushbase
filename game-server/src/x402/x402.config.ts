// x402 Route Pricing Configuration
// Maps HTTP method + path to payment requirements.
// Routes NOT listed here pass through freely (no paywall).

export interface PaidRoute {
  price: string;       // USD string e.g. "$0.01"
  description: string;
}

// Paid endpoints — bracket syntax for path params (x402 convention)
export const PAID_ROUTES: Record<string, PaidRoute> = {
  'GET /ai/replay/[arenaId]': {
    price: '$0.01',
    description: 'Battle replay data for AI analysis',
  },
  'GET /ai/opponents/[arenaId]': {
    price: '$0.005',
    description: 'Opponent stats and threat analysis',
  },
  'GET /ai/strategy/[arenaId]': {
    price: '$0.02',
    description: 'All strategy templates for an arena',
  },
};

// Free endpoints (not configured = free):
// GET /ai/nonce/:address      — Auth flow
// GET /ai/arenas/recommended  — Discovery
// POST /ai/strategy           — Already paid entry fee
// GET /ai/strategy/:a/:b      — Own strategy check
// GET /ai/presets              — Reference data
