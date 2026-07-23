import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import type { Instrumentation } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createNextDatadogInstrumentation,
  detectAwsAmplifyResourceAttributes,
  type NextDatadogRequestError,
} from '../src/instrumentation';
import type { DatadogLogger } from '../src/server';

const createErrorArguments = (
  error: unknown = new Error('render failed'),
): Parameters<Instrumentation.onRequestError> => [
  error,
  {
    headers: {
      'X-Request-ID': 'request-123',
    },
    method: 'POST',
    path: '/orders/123?token=secret#details',
  },
  {
    revalidateReason: undefined,
    renderSource: 'server-rendering',
    routePath: '/orders/[id]',
    routeType: 'render',
    routerKind: 'App Router',
  },
];

const createLogger = (): {
  error: ReturnType<typeof vi.fn<DatadogLogger['error']>>;
  logger: Pick<DatadogLogger, 'error' | 'warn'>;
  warn: ReturnType<typeof vi.fn<DatadogLogger['warn']>>;
} => {
  const error = vi.fn<DatadogLogger['error']>();
  const warn = vi.fn<DatadogLogger['warn']>();

  return {
    error,
    logger: { error, warn },
    warn,
  };
};

afterEach(() => {
  delete process.env.NEXT_RUNTIME;
  vi.restoreAllMocks();
});

describe('detectAwsAmplifyResourceAttributes', () => {
  it('maps available Amplify environment data to resource attributes', () => {
    expect(
      detectAwsAmplifyResourceAttributes({
        AWS_APP_ID: 'app-123',
        AWS_BRANCH: 'main',
        AWS_COMMIT_ID: 'abcdef1',
        AWS_REGION: 'us-east-1',
      }),
    ).toEqual({
      'aws.amplify.app_id': 'app-123',
      'cloud.platform': 'aws_amplify',
      'cloud.provider': 'aws',
      'cloud.region': 'us-east-1',
      'vcs.ref.head.name': 'main',
      'vcs.ref.head.revision': 'abcdef1',
    });
  });

  it('uses the default AWS region and omits unavailable values', () => {
    expect(
      detectAwsAmplifyResourceAttributes({
        AWS_BRANCH: 'preview',
        AWS_DEFAULT_REGION: 'us-west-2',
      }),
    ).toEqual({
      'cloud.platform': 'aws_amplify',
      'cloud.provider': 'aws',
      'cloud.region': 'us-west-2',
      'vcs.ref.head.name': 'preview',
    });
  });

  it('does not classify a generic AWS runtime as Amplify', () => {
    expect(
      detectAwsAmplifyResourceAttributes({
        AWS_DEFAULT_REGION: 'us-west-2',
      }),
    ).toEqual({});
  });
});

describe('createNextDatadogInstrumentation', () => {
  it('registers OpenTelemetry with stable service and resource attributes', async () => {
    const registerOpenTelemetry = vi.fn();
    const { logger } = createLogger();
    const instrumentation = createNextDatadogInstrumentation({
      env: 'production',
      logger,
      otel: {
        attributesFromHeaders: {
          client: 'user-agent',
        },
      },
      registerOpenTelemetry,
      resourceAttributes: {
        'cloud.platform': 'aws_amplify',
        ignored: undefined,
      },
      service: 'checkout-web',
      version: 'abcdef1',
    });

    await instrumentation.register();

    expect(registerOpenTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: {
          'cloud.platform': 'aws_amplify',
          'deployment.environment.name': 'production',
          env: 'production',
          'service.name': 'checkout-web',
          'service.version': 'abcdef1',
        },
        attributesFromHeaders: {
          client: 'user-agent',
        },
        serviceName: 'checkout-web',
        spanProcessors: [expect.any(Object), 'auto'],
      }),
    );
  });

  it('propagates trace context only to normalized outbound origins and composes fetch settings', async () => {
    const registerOpenTelemetry = vi.fn();
    const { logger } = createLogger();
    const existingPropagationRule = /^https:\/\/internal\.example\.com\//;
    const instrumentation = createNextDatadogInstrumentation({
      env: 'production',
      logger,
      otel: {
        instrumentationConfig: {
          fetch: {
            dontPropagateContextUrls: ['https://untrusted.example.com/'],
            ignoreUrls: ['https://telemetry.example.com/'],
            propagateContextUrls: [existingPropagationRule],
          },
        },
      },
      outboundTracingOrigins: [
        ' https://api.example.com ',
        'https://api.example.com/',
        'http://localhost:4000',
      ],
      registerOpenTelemetry,
      service: 'checkout-web',
      version: 'abcdef1',
    });

    await instrumentation.register();

    expect(registerOpenTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        instrumentationConfig: {
          fetch: {
            dontPropagateContextUrls: ['https://untrusted.example.com/'],
            ignoreUrls: ['https://telemetry.example.com/'],
            propagateContextUrls: [
              existingPropagationRule,
              'https://api.example.com/',
              'http://localhost:4000/',
            ],
          },
        },
      }),
    );
  });

  it('registers OpenTelemetry once when concurrent callers share an instrumentation instance', async () => {
    const registerOpenTelemetry = vi.fn(async () => Promise.resolve());
    const { logger } = createLogger();
    const instrumentation = createNextDatadogInstrumentation({
      env: 'production',
      logger,
      registerOpenTelemetry,
      service: 'checkout-web',
      version: 'abcdef1',
    });

    await Promise.all([instrumentation.register(), instrumentation.register()]);

    expect(registerOpenTelemetry).toHaveBeenCalledOnce();
  });

  it.each([
    ['an empty value', ''],
    ['an oversized value', `https://${'a'.repeat(2_048)}.example.com`],
    ['a relative URL', 'api.example.com'],
    ['a path', 'https://api.example.com/v1'],
    ['a query', 'https://api.example.com/?token=secret'],
    ['a fragment', 'https://api.example.com/#fragment'],
    ['credentials', 'https://user:password@api.example.com'],
    ['a non-HTTP protocol', 'ftp://api.example.com'],
  ])('rejects an outbound tracing origin with %s', (_description, origin) => {
    const { logger } = createLogger();

    expect(() =>
      createNextDatadogInstrumentation({
        env: 'production',
        logger,
        outboundTracingOrigins: [origin],
        service: 'checkout-web',
        version: 'abcdef1',
      }),
    ).toThrow('outbound tracing origin');
  });

  it('does not include a rejected origin in the configuration error', () => {
    const { logger } = createLogger();
    const invalidOrigin = 'https://user:secret-password@api.example.com';

    expect(() =>
      createNextDatadogInstrumentation({
        env: 'production',
        logger,
        outboundTracingOrigins: [invalidOrigin],
        service: 'checkout-web',
        version: 'abcdef1',
      }),
    ).toThrow(expect.not.stringContaining('secret-password'));
  });

  it('bounds the outbound tracing origin allowlist', () => {
    const { logger } = createLogger();

    expect(() =>
      createNextDatadogInstrumentation({
        env: 'production',
        logger,
        outboundTracingOrigins: Array.from(
          { length: 33 },
          (_, index) => `https://api-${String(index)}.example.com`,
        ),
        service: 'checkout-web',
        version: 'abcdef1',
      }),
    ).toThrow('at most 32 outbound tracing origins');
  });

  it('rejects non-array and non-string outbound tracing configuration at runtime', () => {
    const { logger } = createLogger();
    const createInstrumentation = (outboundTracingOrigins: unknown) =>
      createNextDatadogInstrumentation({
        env: 'production',
        logger,
        outboundTracingOrigins: outboundTracingOrigins as string[],
        service: 'checkout-web',
        version: 'abcdef1',
      });

    expect(() => createInstrumentation('https://api.example.com')).toThrow(
      'outbound tracing origins must be an array',
    );
    expect(() => createInstrumentation([undefined])).toThrow(
      'outbound tracing origins must be strings',
    );
  });

  it('does not initialize OpenTelemetry on Edge unless explicitly enabled', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const registerOpenTelemetry = vi.fn();
    const { logger } = createLogger();
    const instrumentation = createNextDatadogInstrumentation({
      env: 'production',
      logger,
      registerOpenTelemetry,
      service: 'checkout-web',
      version: 'abcdef1',
    });

    await instrumentation.register();

    expect(registerOpenTelemetry).not.toHaveBeenCalled();
  });

  it('enriches the active span and correlated error log with request metadata', async () => {
    const { error: logError, logger } = createLogger();
    const recordException = vi.fn();
    const setAttributes = vi.fn();
    const setStatus = vi.fn();
    const span = {
      recordException,
      setAttributes,
      setStatus,
    } as unknown as Span;
    vi.spyOn(trace, 'getSpan').mockReturnValue(span);
    const onRequestError = vi.fn<(report: NextDatadogRequestError) => void>();
    const instrumentation = createNextDatadogInstrumentation({
      env: 'production',
      getRequestAttributes: () => ({
        'customer.id': 'cus_123',
        'http.route': '/cannot/override',
      }),
      includeUrlPath: true,
      logger,
      onRequestError,
      service: 'checkout-web',
      version: 'abcdef1',
    });
    const [thrownError, request, requestContext] = createErrorArguments();

    await instrumentation.onRequestError(thrownError, request, requestContext);
    if (!(thrownError instanceof Error)) {
      throw new TypeError('Expected the fixture to provide an Error');
    }

    const expectedAttributes = {
      'customer.id': 'cus_123',
      'http.request.method': 'POST',
      'http.route': '/orders/[id]',
      'nextjs.render_source': 'server-rendering',
      'nextjs.route_type': 'render',
      'nextjs.router_kind': 'App Router',
      'request.id': 'request-123',
      'url.path': '/orders/123',
    };
    expect(recordException).toHaveBeenCalledWith({
      message: 'render failed',
      name: 'Error',
      stack: thrownError.stack,
    });
    expect(setAttributes).toHaveBeenCalledWith(expectedAttributes);
    expect(setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'render failed',
    });
    expect(logError).toHaveBeenCalledWith('Next.js request failed', {
      attributes: expectedAttributes,
      error: thrownError,
    });
    expect(onRequestError).toHaveBeenCalledWith({
      attributes: expectedAttributes,
      context: requestContext,
      error: thrownError,
      request,
    });
  });

  it('normalizes non-Error throws before recording the span exception', async () => {
    const { logger } = createLogger();
    const recordException = vi.fn();
    const span = {
      recordException,
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
    } as unknown as Span;
    vi.spyOn(trace, 'getSpan').mockReturnValue(span);
    const instrumentation = createNextDatadogInstrumentation({
      env: 'test',
      logger,
      service: 'web',
      version: '1',
    });
    const [thrownError, request, requestContext] = createErrorArguments('string failure');

    await instrumentation.onRequestError(thrownError, request, requestContext);

    expect(recordException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'string failure',
        name: 'string',
      }),
    );
  });

  it('adds a bounded Next.js error digest to span and log attributes', async () => {
    const { error: logError, logger } = createLogger();
    const setAttributes = vi.fn();
    vi.spyOn(trace, 'getSpan').mockReturnValue({
      recordException: vi.fn(),
      setAttributes,
      setStatus: vi.fn(),
    } as unknown as Span);
    const instrumentation = createNextDatadogInstrumentation({
      env: 'test',
      getRequestAttributes: () => ({
        'error.digest': 'cannot-override',
      }),
      logger,
      service: 'web',
      version: '1',
    });
    const error = Object.assign(new Error('render failed'), {
      digest: 'd'.repeat(300),
    });

    await instrumentation.onRequestError(...createErrorArguments(error));

    const expectedDigest = 'd'.repeat(256);
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'error.digest': expectedDigest,
      }),
    );
    expect(logError).toHaveBeenCalledOnce();
    expect(logError.mock.calls[0]?.[0]).toBe('Next.js request failed');
    expect(logError.mock.calls[0]?.[1]?.attributes?.['error.digest']).toBe(expectedDigest);
  });

  it('omits the concrete URL path by default', async () => {
    const { error, logger } = createLogger();
    const instrumentation = createNextDatadogInstrumentation({
      env: 'test',
      logger,
      service: 'web',
      version: '1',
    });

    await instrumentation.onRequestError(...createErrorArguments());

    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[1]?.attributes).not.toHaveProperty('url.path');
  });

  it('reserves capacity and names for framework request attributes', async () => {
    const { error, logger } = createLogger();
    const customAttributes = Object.fromEntries(
      Array.from({ length: 70 }, (_, index) => [`custom.${String(index)}`, index]),
    );
    const instrumentation = createNextDatadogInstrumentation({
      env: 'test',
      getRequestAttributes: () => ({
        ...customAttributes,
        'request.id': 'cannot-override',
      }),
      logger,
      service: 'web',
      version: '1',
    });

    await instrumentation.onRequestError(...createErrorArguments());

    const attributes = error.mock.calls[0]?.[1]?.attributes;
    expect(attributes?.['request.id']).toBe('request-123');
    expect(attributes?.['http.route']).toBe('/orders/[id]');
    expect(Object.keys(attributes ?? {}).filter((key) => key.startsWith('custom.'))).toHaveLength(
      48,
    );
  });

  it('contains optional telemetry callback failures and reports diagnostics', async () => {
    const { logger, warn } = createLogger();
    const instrumentation = createNextDatadogInstrumentation({
      env: 'test',
      getRequestAttributes: () => {
        throw new Error('attribute callback failed');
      },
      logger,
      onRequestError: () => {
        throw new Error('report callback failed');
      },
      service: 'web',
      version: '1',
    });

    await expect(
      instrumentation.onRequestError(...createErrorArguments()),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      'nextjs-datadog telemetry reporting failed',
      expect.objectContaining({
        attributes: {
          'nextjs_datadog.diagnostic': 'request_attributes',
        },
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      'nextjs-datadog telemetry reporting failed',
      expect.objectContaining({
        attributes: {
          'nextjs_datadog.diagnostic': 'request_error_callback',
        },
      }),
    );
  });

  it('contains span, log, and diagnostic writer failures', async () => {
    const warn = vi.fn(() => {
      throw new Error('diagnostic writer failed');
    });
    const logger = {
      error: vi.fn(() => {
        throw new Error('error writer failed');
      }),
      warn,
    };
    const span = {
      recordException: vi.fn(() => {
        throw new Error('span failed');
      }),
    } as unknown as Span;
    vi.spyOn(trace, 'getSpan').mockReturnValue(span);
    const instrumentation = createNextDatadogInstrumentation({
      env: 'test',
      logger,
      service: 'web',
      version: '1',
    });

    await expect(
      instrumentation.onRequestError(...createErrorArguments()),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
