import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const clientBundlePath = resolve('dist/client.js');
const clientBundle = readFileSync(clientBundlePath, 'utf8');
const forbiddenDependencies = [
  '@opentelemetry/api',
  '@vercel/otel',
  'next/server',
  'next/server.js',
  'node:',
  './instrumentation',
  './server',
];
const violations = forbiddenDependencies.filter((dependency) => clientBundle.includes(dependency));

if (violations.length > 0) {
  throw new Error(`The client bundle contains server-only dependencies: ${violations.join(', ')}`);
}

const compressedBytes = gzipSync(clientBundle).byteLength;
const maximumCompressedBytes = 8 * 1_024;

if (compressedBytes > maximumCompressedBytes) {
  throw new Error(
    `The client bundle is ${compressedBytes} compressed bytes; the limit is ${maximumCompressedBytes}`,
  );
}

console.log(`Client boundary valid (${compressedBytes} compressed bytes).`);
