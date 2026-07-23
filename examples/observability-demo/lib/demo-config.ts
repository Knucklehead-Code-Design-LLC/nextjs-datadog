export const demoTags = {
  env: process.env.DD_ENV ?? 'demo',
  service: process.env.DD_SERVICE ?? 'nextjs-observability-demo',
  version: process.env.DD_VERSION ?? '1.0.0',
} as const;
