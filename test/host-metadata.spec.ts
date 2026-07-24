import { context, propagation, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it } from 'vitest';

import { createNextDatadogInstrumentation } from '../src/instrumentation';

afterEach(() => {
  context.disable();
  propagation.disable();
  trace.disable();
  delete process.env.VERCEL;
});

describe('host metadata', () => {
  it('does not export Vercel runtime metadata outside Vercel', async () => {
    const exporter = new InMemorySpanExporter();
    const instrumentation = createNextDatadogInstrumentation({
      env: 'development',
      otel: {
        autoDetectResources: false,
        instrumentations: [],
        propagators: ['none'],
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      },
      service: 'checkout-web',
      version: 'abcdef1',
    });

    await instrumentation.register();

    const span = trace.getTracer('host-metadata-test').startSpan('host metadata');
    span.end();

    const resourceAttributes = exporter.getFinishedSpans()[0]?.resource.attributes;
    expect(resourceAttributes).toMatchObject({
      'deployment.environment.name': 'development',
      'process.runtime.name': 'nodejs',
      'service.name': 'checkout-web',
      'service.version': 'abcdef1',
    });
    expect(resourceAttributes).not.toHaveProperty('vercel.runtime');
  });
});
