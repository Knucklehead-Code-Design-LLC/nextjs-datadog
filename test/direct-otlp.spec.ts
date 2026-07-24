import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { Configuration as VercelOtelConfiguration } from '@vercel/otel';
import { describe, expect, it, vi } from 'vitest';

import { registerDirectDatadogOtlp, type RegisterOpenTelemetry } from '../src/internal/direct-otlp';

describe('direct Datadog OTLP delivery', () => {
  it('creates the production HTTP/protobuf span processor', async () => {
    const registerOpenTelemetry = vi.fn<RegisterOpenTelemetry>();

    await registerDirectDatadogOtlp(
      {},
      {
        apiKey: 'a'.repeat(32),
        site: 'datadoghq.com',
      },
      {
        registerOpenTelemetry,
      },
    );

    const configuration = registerOpenTelemetry.mock.calls[0]?.[0];
    expect(configuration?.spanProcessors).toHaveLength(1);
    expect(configuration?.spanProcessors?.[0]?.constructor.name).toBe('SimpleSpanProcessor');
  });

  it('uses Datadog intake with server-only authentication and immediate export', async () => {
    const privacyProcessor = {} as SpanProcessor;
    const directProcessor = {} as SpanProcessor;
    const createSpanProcessor = vi.fn(() => Promise.resolve(directProcessor));
    const registerOpenTelemetry = vi.fn();
    const configuration = {
      serviceName: 'checkout-web',
      spanProcessors: [privacyProcessor, 'auto'],
    } satisfies VercelOtelConfiguration;

    await registerDirectDatadogOtlp(
      configuration,
      {
        apiKey: ` ${'a'.repeat(32)} `,
        site: ' US5.DATADOGHQ.COM ',
      },
      {
        createSpanProcessor,
        registerOpenTelemetry,
      },
    );

    expect(createSpanProcessor).toHaveBeenCalledWith({
      endpoint: 'https://otlp.us5.datadoghq.com/v1/traces',
      headers: {
        compute_stats: 'true',
        'dd-api-key': 'a'.repeat(32),
      },
    });
    expect(registerOpenTelemetry).toHaveBeenCalledWith({
      serviceName: 'checkout-web',
      spanProcessors: [privacyProcessor, directProcessor],
    });
  });

  it.each([
    ['an unknown host', 'example.com'],
    ['a Datadog lookalike', 'us5.datadoghq.com.attacker.invalid'],
    ['a URL instead of a site', 'https://us5.datadoghq.com'],
    ['a site with a path', 'us5.datadoghq.com/v1/traces'],
  ])('rejects %s before creating an authenticated exporter', async (_description, site) => {
    const createSpanProcessor = vi.fn();
    const registerOpenTelemetry = vi.fn();

    await expect(
      registerDirectDatadogOtlp(
        {},
        {
          apiKey: 'a'.repeat(32),
          site,
        },
        {
          createSpanProcessor,
          registerOpenTelemetry,
        },
      ),
    ).rejects.toThrow('unsupported Datadog site');
    expect(createSpanProcessor).not.toHaveBeenCalled();
    expect(registerOpenTelemetry).not.toHaveBeenCalled();
  });

  it('rejects an invalid API key without including its value in the error', async () => {
    const createSpanProcessor = vi.fn();

    await expect(
      registerDirectDatadogOtlp(
        {},
        {
          apiKey: 'not-a-datadog-api-key',
          site: 'us5.datadoghq.com',
        },
        {
          createSpanProcessor,
        },
      ),
    ).rejects.toThrow('invalid Datadog API key');
    expect(createSpanProcessor).not.toHaveBeenCalled();
  });
});
