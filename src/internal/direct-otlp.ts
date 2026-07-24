import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { Configuration as VercelOtelConfiguration } from '@vercel/otel';

import type { DatadogDirectOtlpOptions } from '../types';

const DATADOG_API_KEY_PATTERN = /^[A-Za-z0-9]{32}$/;
const DATADOG_SITES = new Set([
  'ap1.datadoghq.com',
  'ap2.datadoghq.com',
  'datadoghq.com',
  'datadoghq.eu',
  'ddog-gov.com',
  'us3.datadoghq.com',
  'us5.datadoghq.com',
]);

export type RegisterOpenTelemetry = (
  configuration: VercelOtelConfiguration,
) => Promise<void> | void;

type CreateSpanProcessor = (options: {
  endpoint: string;
  headers: Readonly<Record<string, string>>;
}) => Promise<SpanProcessor>;

interface DirectOtlpDependencies {
  createSpanProcessor?: CreateSpanProcessor;
  registerOpenTelemetry?: RegisterOpenTelemetry;
}

const normalizeApiKey = (apiKey: string): string => {
  const normalizedApiKey = apiKey.trim();

  if (!DATADOG_API_KEY_PATTERN.test(normalizedApiKey)) {
    throw new TypeError('nextjs-datadog received an invalid Datadog API key');
  }

  return normalizedApiKey;
};

const createDatadogTracesEndpoint = (site: string): string => {
  const normalizedSite = site.trim().toLowerCase();

  if (!DATADOG_SITES.has(normalizedSite)) {
    throw new TypeError('nextjs-datadog received an unsupported Datadog site');
  }

  return `https://otlp.${normalizedSite}/v1/traces`;
};

const createDirectSpanProcessor: CreateSpanProcessor = async ({ endpoint, headers }) => {
  const [{ SimpleSpanProcessor }, { OTLPHttpProtoTraceExporter }] = await Promise.all([
    import('@opentelemetry/sdk-trace-base'),
    import('@vercel/otel'),
  ]);
  const exporter = new OTLPHttpProtoTraceExporter({
    headers: { ...headers },
    url: endpoint,
  });

  return new SimpleSpanProcessor(exporter);
};

export const registerDirectDatadogOtlp = async (
  configuration: VercelOtelConfiguration,
  options: DatadogDirectOtlpOptions,
  dependencies: DirectOtlpDependencies = {},
): Promise<void> => {
  const apiKey = normalizeApiKey(options.apiKey);
  const endpoint = createDatadogTracesEndpoint(options.site);
  const directSpanProcessor = await (dependencies.createSpanProcessor ?? createDirectSpanProcessor)(
    {
      endpoint,
      headers: {
        compute_stats: 'true',
        'dd-api-key': apiKey,
      },
    },
  );
  const configuredSpanProcessors =
    configuration.spanProcessors?.filter((processor) => processor !== 'auto') ?? [];
  const register =
    dependencies.registerOpenTelemetry ??
    (async (otelConfiguration: VercelOtelConfiguration) => {
      const { registerOTel } = await import('@vercel/otel');
      registerOTel(otelConfiguration);
    });

  await register({
    ...configuration,
    spanProcessors: [...configuredSpanProcessors, directSpanProcessor],
  });
};
