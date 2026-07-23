import { context as otelContext, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import type { Instrumentation } from 'next';
import type { Configuration as VercelOtelConfiguration } from '@vercel/otel';

import { normalizeTelemetryAttributes } from './internal/attributes';
import { normalizeUnifiedServiceTags } from './internal/config';
import {
  DEFAULT_REQUEST_ID_HEADER,
  getRecordHeader,
  normalizeHeaderName,
  normalizeRequestId,
  stripQueryAndFragment,
} from './internal/request';
import { createDatadogLogger, type DatadogLogger, type SerializedError } from './server';
import type { TelemetryAttributes, UnifiedServiceTags } from './types';

type RequestError = Parameters<Instrumentation.onRequestError>[0];
type RequestErrorRequest = Parameters<Instrumentation.onRequestError>[1];
type RequestErrorContext = Parameters<Instrumentation.onRequestError>[2];

export interface NextDatadogRequestError {
  attributes: Readonly<Record<string, boolean | number | string>>;
  context: RequestErrorContext;
  error: RequestError;
  request: RequestErrorRequest;
}

export type RegisterOpenTelemetry = (
  configuration: VercelOtelConfiguration,
) => Promise<void> | void;

export interface NextDatadogInstrumentationOptions extends UnifiedServiceTags {
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
  register(): Promise<void>;
}

type Environment = Readonly<Record<string, string | undefined>>;

const CUSTOM_REQUEST_ATTRIBUTE_LIMIT = 48;
const REQUEST_ATTRIBUTE_KEYS = new Set([
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

  const exception = error instanceof Error ? error : new Error(String(error));

  span.recordException(exception);
  span.setAttributes(attributes);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: exception.message,
  });
};

const createRequestAttributes = (
  request: RequestErrorRequest,
  requestContext: RequestErrorContext,
  requestIdHeader: string,
  includeUrlPath: boolean,
): TelemetryAttributes => {
  const requestId = normalizeRequestId(getRecordHeader(request.headers, requestIdHeader));

  return {
    'http.request.method': request.method,
    'http.route': requestContext.routePath,
    'nextjs.render_source': requestContext.renderSource,
    'nextjs.revalidate_reason': requestContext.revalidateReason,
    'nextjs.route_type': requestContext.routeType,
    'nextjs.router_kind': requestContext.routerKind,
    ...(requestId ? { 'request.id': requestId } : {}),
    ...(includeUrlPath ? { 'url.path': stripQueryAndFragment(request.path) } : {}),
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

export const detectAwsAmplifyResourceAttributes = (
  environment: Environment = process.env,
): Record<string, string> => {
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

export const createNextDatadogInstrumentation = (
  options: NextDatadogInstrumentationOptions,
): NextDatadogInstrumentation => {
  const tags = normalizeUnifiedServiceTags(options);
  const requestIdHeader = normalizeHeaderName(options.requestIdHeader ?? DEFAULT_REQUEST_ID_HEADER);
  const logger =
    options.logger ??
    createDatadogLogger({
      ...tags,
      ...(options.transformError ? { transformError: options.transformError } : {}),
    });

  const register = async (): Promise<void> => {
    if (process.env.NEXT_RUNTIME === 'edge' && !options.instrumentEdgeRuntime) {
      return;
    }

    const resourceAttributes = normalizeTelemetryAttributes(options.resourceAttributes);
    const configuration: VercelOtelConfiguration = {
      ...options.otel,
      attributes: {
        ...resourceAttributes,
        'deployment.environment.name': tags.env,
        env: tags.env,
        'service.name': tags.service,
        'service.version': tags.version,
      },
      serviceName: tags.service,
    };
    const registerOpenTelemetry = options.registerOpenTelemetry ?? registerDefaultOpenTelemetry;

    await registerOpenTelemetry(configuration);
  };

  const onRequestError: Instrumentation.onRequestError = async (error, request, requestContext) => {
    const baseRequestError = {
      context: requestContext,
      error,
      request,
    };
    let customAttributes: TelemetryAttributes = {};

    if (options.getRequestAttributes) {
      try {
        customAttributes = await options.getRequestAttributes(baseRequestError);
      } catch (attributeError) {
        writeDiagnostic(logger, 'request_attributes', attributeError);
      }
    }

    const normalizedCustomAttributes = normalizeTelemetryAttributes(customAttributes, {
      attributeLimit: CUSTOM_REQUEST_ATTRIBUTE_LIMIT,
      reservedKeys: REQUEST_ATTRIBUTE_KEYS,
    });
    const requestAttributes = normalizeTelemetryAttributes(
      createRequestAttributes(
        request,
        requestContext,
        requestIdHeader,
        options.includeUrlPath ?? false,
      ),
    );
    const attributes = {
      ...normalizedCustomAttributes,
      ...requestAttributes,
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

  return {
    onRequestError,
    register,
  };
};

export type { Instrumentation, TelemetryAttributes, UnifiedServiceTags, VercelOtelConfiguration };
