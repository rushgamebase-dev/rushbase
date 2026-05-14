const DEFAULT_ALLOWED_ORIGINS = [
  'https://rushgame.vip',
  'https://www.rushgame.vip',
  'http://localhost:3000',
  'http://localhost:3001',
] as const;

export function getAllowedOrigins(): string[] {
  const configured = [
    process.env.FRONTEND_URL,
    process.env.CORS_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap(value => value!.split(','))
    .map(origin => origin.trim())
    .filter(Boolean);

  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]));
}
