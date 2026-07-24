import { context as otelContext, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import type { Instrumentation } from 'next';
import type { Configuration as VercelOtelConfiguration } from '@vercel/otel';

import { normalizeTelemetryAttributes } from './internal/attributes';
import { normalizeUnifiedServiceTags } from './internal/config';
import { normalizeOutboundTracingOrigins } from './internal/outbound-tracing';
import {
  DEFAULT_REQUEST_ID_HEADER,
  getRecordHeader,
  normalizeHeaderName,
  normalizeRequestId,
  stripQueryAndFragment,
} from './internal/request';
import { createTelemetryPrivacySpanProcessor } from './internal/span-privacy';
import {
  createDatadogLogger,
  serializeError,
  type CreateDatadogLoggerOptions,
  type DatadogLogger,
  type SerializedError,
} from './server';
import type { DatadogDirectOtlpOptions, TelemetryAttributes, UnifiedServiceTags } from './types';
import { registerDirectDatadogOtlp, type RegisterOpenTelemetry } from './internal/direct-otlp';

type RequestError = Parameters<Instrumentation.onRequestError>[0];
type RequestErrorRequest = Parameters<Instrumentation.onRequestError>[1];
type RequestErrorContext = Parameters<Instrumentation.onRequestError>[2];

export interface NextDatadogRequestError {
  attributes: Readonly<Record<string, boolean | number | string>>;
  context: RequestErrorContext;
  error: RequestError;
  request: RequestErrorRequest;
}

export interface NextDatadogInstrumentationOptions extends UnifiedServiceTags {
  /**
   * Deliver each completed span directly to Datadog's OTLP/HTTP intake.
   *
   * Use this only in short-lived managed runtimes that cannot run or reach an
   * OpenTelemetry Collector or Datadog Agent.
   */
  directOtlp?: DatadogDirectOtlpOptions;
  /**
   * Add low-cardinality application attributes after authentication or routing.
   */
  getRequestAttributes?: (
    requestError: Omit<NextDatadogRequestError, 'attributes'>,
  ) => Promise<TelemetryAttributes> | TelemetryAttributes;
  /**
   * Enable the default OpenTelemetry registration in the Edge runtime.
   *
   * @defaultValue false
   */
  instrumentEdgeRuntime?: boolean;
  /**
   * Add the concrete URL path to error metadata after removing its query and
   * fragment. Keep disabled when paths can contain personal or sensitive data.
   *
   * @defaultValue false
   */
  includeUrlPath?: boolean;
  logger?: Pick<DatadogLogger, 'error' | 'warn'>;
  /**
   * Receive a completed report after span and log enrichment.
   */
  onRequestError?: (requestError: NextDatadogRequestError) => Promise<void> | void;
  /**
   * Exact HTTP(S) origins that may receive W3C trace context from server-side
   * fetch, Axios, and Node.js HTTP requests.
   *
   * @exampleValue ['https://api.example.com', 'http://localhost:4000']
   */
  outboundTracingOrigins?: readonly string[];
  /**
   * Additional @vercel/otel configuration. Service and resource attributes are
   * owned by nextjs-datadog.
   */
  otel?: Omit<VercelOtelConfiguration, 'attributes' | 'serviceName'>;
  registerOpenTelemetry?: RegisterOpenTelemetry;
  requestIdHeader?: string;
  resourceAttributes?: TelemetryAttributes;
  transformError?: (error: Readonly<SerializedError>) => SerializedError;
}

export interface NextDatadogInstrumentation {
  onRequestError: Instrumentation.onRequestError;
  register: () => Promise<void>;
}

type Environment = Readonly<Record<string, string | undefined>>;

const CUSTOM_REQUEST_ATTRIBUTE_LIMIT = 48;
const REQUEST_ATTRIBUTE_KEYS = new Set([
  'error.digest',
  'http.request.method',
  'http.route',
  'nextjs.render_source',
  'nextjs.revalidate_reason',
  'nextjs.route_type',
  'nextjs.router_kind',
  'request.id',
  'url.path',
]);

const setSpanError = (
  span: Span | undefined,
  error: RequestError,
  attributes: Readonly<Record<string, boolean | number | string>>,
): void => {
  if (!span) {
    return;
  }

  const serializedError = serializeError(error);
  const exception: {
    message: string;
    name: string;
    stack?: string;
  } = {
    message: serializedError.message,
    name: serializedError.kind,
  };

  if (serializedError.stack) {
    exception.stack = serializedError.stack;
  }

  span.recordException(exception);
  span.setAttributes(attributes);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: serializedError.message,
  });
};

const createRequestAttributes = (
  request: RequestErrorRequest,
  requestContext: RequestErrorContext,
  requestIdHeader: string,
  includeUrlPath: boolean,
): TelemetryAttributes => {
  const requestId = normalizeRequestId(getRecordHeader(request.headers, requestIdHeader));
  const attributes: Record<string, boolean | number | string | undefined> = {
    'http.request.method': request.method,
    'http.route': requestContext.routePath,
    'nextjs.render_source': requestContext.renderSource,
    'nextjs.revalidate_reason': requestContext.revalidateReason,
    'nextjs.route_type': requestContext.routeType,
    'nextjs.router_kind': requestContext.routerKind,
  };

  if (requestId) {
    attributes['request.id'] = requestId;
  }

  if (includeUrlPath) {
    attributes['url.path'] = stripQueryAndFragment(request.path);
  }

  return attributes;
};

const createErrorAttributes = (error: RequestError): TelemetryAttributes => {
  const serializedError = serializeError(error);
  if (!serializedError.digest) {
    return {};
  }

  return {
    'error.digest': serializedError.digest,
  };
};

const writeDiagnostic = (
  logger: Pick<DatadogLogger, 'warn'>,
  diagnostic: string,
  error: unknown,
): void => {
  try {
    logger.warn('nextjs-datadog telemetry reporting failed', {
      attributes: {
        'nextjs_datadog.diagnostic': diagnostic,
      },
      error,
    });
  } catch {
    // A diagnostic failure must never affect the application error path.
  }
};

const registerDefaultOpenTelemetry: RegisterOpenTelemetry = async (configuration) => {
  const { registerOTel } = await import('@vercel/otel');
  registerOTel(configuration);
};

const isAwsAmplifyEnvironment = (environment: Environment): boolean => {
  const identityValues = [
    environment.AWS_APP_ID,
    environment.AWS_BRANCH,
    environment.AWS_COMMIT_ID,
  ];

  return identityValues.some((value) => typeof value === 'string' && value.length > 0);
};

const createHostCompatibilityResourceAttributes = (
  environment: Environment,
): TelemetryAttributes => {
  if (environment.VERCEL === '1') {
    return {};
  }

  return {
    'vercel.runtime': undefined,
  };
};

export const detectAwsAmplifyResourceAttributes = (
  environment: Environment = process.env,
): Record<string, string> => {
  if (!isAwsAmplifyEnvironment(environment)) {
    return {};
  }

  const region = environment.AWS_REGION ?? environment.AWS_DEFAULT_REGION;

  return normalizeTelemetryAttributes({
    'aws.amplify.app_id': environment.AWS_APP_ID,
    'cloud.platform': 'aws_amplify',
    'cloud.provider': 'aws',
    'cloud.region': region,
    'vcs.ref.head.name': environment.AWS_BRANCH,
    'vcs.ref.head.revision': environment.AWS_COMMIT_ID,
  }) as Record<string, string>;
};

const createDefaultLogger = (
  tags: Readonly<UnifiedServiceTags>,
  options: NextDatadogInstrumentationOptions,
): DatadogLogger => {
  const loggerOptions: CreateDatadogLoggerOptions = { ...tags };
  if (options.transformError) {
    loggerOptions.transformError = options.transformError;
  }

  return createDatadogLogger(loggerOptions);
};

const createSpanProcessors = (
  options: NextDatadogInstrumentationOptions,
): NonNullable<VercelOtelConfiguration['spanProcessors']> => {
  const privacyProcessor = createTelemetryPrivacySpanProcessor();
  if (!options.otel?.spanProcessors) {
    return [privacyProcessor, 'auto'];
  }

  return [privacyProcessor, ...options.otel.spanProcessors];
};

const createOpenTelemetryConfiguration = (
  options: NextDatadogInstrumentationOptions,
  tags: Readonly<UnifiedServiceTags>,
  outboundTracingOrigins: readonly string[],
): VercelOtelConfiguration => {
  const resourceAttributes = normalizeTelemetryAttributes(options.resourceAttributes);
  const configuration: VercelOtelConfiguration = {
    ...options.otel,
    attributes: {
      ...resourceAttributes,
      ...createHostCompatibilityResourceAttributes(process.env),
      'deployment.environment.name': tags.env,
      env: tags.env,
      'service.name': tags.service,
      'service.version': tags.version,
    },
    serviceName: tags.service,
    spanProcessors: createSpanProcessors(options),
  };

  if (outboundTracingOrigins.length === 0) {
    return configuration;
  }

  const configuredPropagationUrls =
    options.otel?.instrumentationConfig?.fetch?.propagateContextUrls ?? [];
  configuration.instrumentationConfig = {
    ...options.otel?.instrumentationConfig,
    fetch: {
      ...options.otel?.instrumentationConfig?.fetch,
      propagateContextUrls: [...configuredPropagationUrls, ...outboundTracingOrigins],
    },
  };

  return configuration;
};

const createRegister = (
  options: NextDatadogInstrumentationOptions,
  tags: Readonly<UnifiedServiceTags>,
  outboundTracingOrigins: readonly string[],
  logger: Pick<DatadogLogger, 'warn'>,
): (() => Promise<void>) => {
  let registration: Promise<void> | undefined;

  const registerOnce = async (): Promise<void> => {
    if (process.env.NEXT_RUNTIME === 'edge' && !options.instrumentEdgeRuntime) {
      return;
    }

    const configuration = createOpenTelemetryConfiguration(options, tags, outboundTracingOrigins);

    if (options.directOtlp) {
      try {
        let directOtlpDependencies: Parameters<typeof registerDirectDatadogOtlp>[2];
        if (options.registerOpenTelemetry) {
          directOtlpDependencies = {
            registerOpenTelemetry: options.registerOpenTelemetry,
          };
        }

        await registerDirectDatadogOtlp(configuration, options.directOtlp, directOtlpDependencies);
      } catch (error) {
        writeDiagnostic(logger, 'direct_otlp_registration', error);
      }
      return;
    }

    const registerOpenTelemetry = options.registerOpenTelemetry ?? registerDefaultOpenTelemetry;
    await registerOpenTelemetry(configuration);
  };

  return (): Promise<void> => {
    registration ??= registerOnce();
    return registration;
  };
};

const getCustomRequestAttributes = async (
  options: NextDatadogInstrumentationOptions,
  requestError: Omit<NextDatadogRequestError, 'attributes'>,
  logger: Pick<DatadogLogger, 'warn'>,
): Promise<TelemetryAttributes> => {
  if (!options.getRequestAttributes) {
    return {};
  }

  try {
    return await options.getRequestAttributes(requestError);
  } catch (error) {
    writeDiagnostic(logger, 'request_attributes', error);
    return {};
  }
};

const createOnRequestError = (
  options: NextDatadogInstrumentationOptions,
  logger: Pick<DatadogLogger, 'error' | 'warn'>,
  requestIdHeader: string,
): Instrumentation.onRequestError => {
  return async (error, request, requestContext) => {
    const baseRequestError = {
      context: requestContext,
      error,
      request,
    };
    const customAttributes = await getCustomRequestAttributes(options, baseRequestError, logger);
    const normalizedCustomAttributes = normalizeTelemetryAttributes(customAttributes, {
      attributeLimit: CUSTOM_REQUEST_ATTRIBUTE_LIMIT,
      reservedKeys: REQUEST_ATTRIBUTE_KEYS,
    });
    const requestAttributes = normalizeTelemetryAttributes(
      createRequestAttributes(
        request,
        requestContext,
        requestIdHeader,
        options.includeUrlPath === true,
      ),
    );
    const errorAttributes = normalizeTelemetryAttributes(createErrorAttributes(error));
    const attributes = {
      ...normalizedCustomAttributes,
      ...requestAttributes,
      ...errorAttributes,
    };
    const requestError: NextDatadogRequestError = {
      ...baseRequestError,
      attributes,
    };

    try {
      setSpanError(trace.getSpan(otelContext.active()), error, attributes);
    } catch (spanError) {
      writeDiagnostic(logger, 'span_enrichment', spanError);
    }

    try {
      logger.error('Next.js request failed', {
        attributes,
        error,
      });
    } catch (logError) {
      writeDiagnostic(logger, 'error_log', logError);
    }

    if (options.onRequestError) {
      try {
        await options.onRequestError(requestError);
      } catch (callbackError) {
        writeDiagnostic(logger, 'request_error_callback', callbackError);
      }
    }
  };
};

export const createNextDatadogInstrumentation = (
  options: NextDatadogInstrumentationOptions,
): NextDatadogInstrumentation => {
  const tags = normalizeUnifiedServiceTags(options);
  const outboundTracingOrigins = normalizeOutboundTracingOrigins(options.outboundTracingOrigins);
  const requestIdHeader = normalizeHeaderName(options.requestIdHeader ?? DEFAULT_REQUEST_ID_HEADER);
  const logger = options.logger ?? createDefaultLogger(tags, options);
  const register = createRegister(options, tags, outboundTracingOrigins, logger);
  const onRequestError = createOnRequestError(options, logger, requestIdHeader);

  return {
    onRequestError,
    register,
  };
};

export type {
  DatadogDirectOtlpOptions,
  Instrumentation,
  RegisterOpenTelemetry,
  TelemetryAttributes,
  UnifiedServiceTags,
  VercelOtelConfiguration,
};
