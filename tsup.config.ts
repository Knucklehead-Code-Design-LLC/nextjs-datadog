import { defineConfig } from 'tsup';

const external = [
  '@datadog/browser-rum',
  '@datadog/browser-rum-nextjs',
  '@opentelemetry/api',
  '@vercel/otel',
  'next',
  'next/server',
  'next/server.js',
  'react',
];

export default defineConfig({
  clean: true,
  dts: {
    resolve: false,
  },
  entry: {
    client: 'src/client.ts',
    index: 'src/index.ts',
    instrumentation: 'src/instrumentation.ts',
    proxy: 'src/proxy.ts',
    server: 'src/server.ts',
  },
  external,
  format: ['esm'],
  minify: false,
  outDir: 'dist',
  platform: 'neutral',
  shims: false,
  sourcemap: true,
  splitting: false,
  target: 'es2022',
  treeshake: true,
});
