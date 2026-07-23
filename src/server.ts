import { context, isSpanContextValid, trace } from '@opentelemetry/api';

import { normalizeTelemetryAttributes } from './internal/attributes';
import { normalizeUnifiedServiceTags } from './internal/config';
import type {
  TelemetryAttributes,
  TelemetryAttributeValue,
  TraceIdentifiers,
  UnifiedServiceTags,
} from './types';

const MAX_ERROR_MESSAGE_LENGTH = 4_096;
const MAX_ERROR_STACK_LENGTH = 32_768;
const MAX_LOG_MESSAGE_LENGTH = 4_096;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const RESERVED_LOG_KEYS = new Set([
  'env',
  'error',
  'error.digest',
  'error.kind',
  'error.message',
  'error.stack',
  'level',
  'message',
  'service',
  'span_id',
  'status',
  'timestamp',
  'trace_id',
  'version',
]);

export type DatadogLogLevel = 'debug' | 'error' | 'info' | 'warn';

export interface SerializedError {
  digest?: string;
  kind: string;
  message: string;
  stack?: string;
}

export interface DatadogLogRecord {
  [key: string]: unknown;
  env: string;
  error?: SerializedError;
  level: DatadogLogLevel;
  message: string;
  service: string;
  span_id?: string;
  status: DatadogLogLevel;
  timestamp: string;
  trace_id?: string;
  version: string;
}

export interface DatadogLogDetails {
  attributes?: TelemetryAttributes;
  error?: unknown;
}

export type DatadogLogWriter = (level: DatadogLogLevel, record: Readonly<DatadogLogRecord>) => void;

export interface CreateDatadogLoggerOptions extends UnifiedServiceTags {
  clock?: () => Date;
  getTraceIdentifiers?: () => TraceIdentifiers | undefined;
  onWriteError?: (error: unknown) => void;
  transformError?: (error: Readonly<SerializedError>) => SerializedError;
  write?: DatadogLogWriter;
}

export interface DatadogLogger {
  debug(message: string, details?: DatadogLogDetails): void;
  error(message: string, details?: DatadogLogDetails): void;
  info(message: string, details?: DatadogLogDetails): void;
  log(level: DatadogLogLevel, message: string, details?: DatadogLogDetails): void;
  warn(message: string, details?: DatadogLogDetails): void;
}

const defaultWriter: DatadogLogWriter = (level, record) => {
  const serializedRecord = JSON.stringify(record);

  if (level === 'error') {
    console.error(serializedRecord);
    return;
  }

  if (level === 'warn') {
    console.warn(serializedRecord);
    return;
  }

  if (level === 'debug') {
    console.debug(serializedRecord);
    return;
  }

  console.info(serializedRecord);
};

export const getActiveTraceIdentifiers = (): TraceIdentifiers | undefined => {
  const spanContext = trace.getSpan(context.active())?.spanContext();

  if (!spanContext || !isSpanContextValid(spanContext)) {
    return undefined;
  }

  return {
    spanId: spanContext.spanId,
    traceId: spanContext.traceId,
  };
};

export const serializeError = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    const digest =
      'digest' in error && typeof error.digest === 'string'
        ? error.digest.slice(0, 256)
        : undefined;

    return {
      ...(digest ? { digest } : {}),
      kind: error.name || 'Error',
      message: error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
      ...(error.stack ? { stack: error.stack.slice(0, MAX_ERROR_STACK_LENGTH) } : {}),
    };
  }

  return {
    kind: typeof error,
    message: String(error).slice(0, MAX_ERROR_MESSAGE_LENGTH),
  };
};

export const createDatadogLogger = (options: CreateDatadogLoggerOptions): DatadogLogger => {
  const tags = normalizeUnifiedServiceTags(options);
  const clock = options.clock ?? (() => new Date());
  const getTraceIdentifiers = options.getTraceIdentifiers ?? getActiveTraceIdentifiers;
  const write = options.write ?? defaultWriter;

  const log = (level: DatadogLogLevel, message: string, details: DatadogLogDetails = {}): void => {
    try {
      const attributes = normalizeTelemetryAttributes(details.attributes, {
        reservedKeys: RESERVED_LOG_KEYS,
      });
      const traceIdentifiers = getTraceIdentifiers();
      const correlatableTraceIdentifiers =
        traceIdentifiers &&
        SPAN_ID_PATTERN.test(traceIdentifiers.spanId) &&
        TRACE_ID_PATTERN.test(traceIdentifiers.traceId)
          ? traceIdentifiers
          : undefined;
      const rawError = details.error === undefined ? undefined : serializeError(details.error);
      const transformedError =
        rawError && options.transformError ? options.transformError(rawError) : rawError;
      const record: DatadogLogRecord = {
        ...attributes,
        env: tags.env,
        level,
        message: message.slice(0, MAX_LOG_MESSAGE_LENGTH),
        service: tags.service,
        ...(correlatableTraceIdentifiers
          ? {
              span_id: correlatableTraceIdentifiers.spanId,
              trace_id: correlatableTraceIdentifiers.traceId,
            }
          : {}),
        status: level,
        timestamp: clock().toISOString(),
        version: tags.version,
        ...(transformedError ? { error: transformedError } : {}),
      };

      write(level, record);
    } catch (error) {
      try {
        options.onWriteError?.(error);
      } catch {
        // Telemetry delivery must not break the application.
      }
    }
  };

  return {
    debug: (message, details) => {
      log('debug', message, details);
    },
    error: (message, details) => {
      log('error', message, details);
    },
    info: (message, details) => {
      log('info', message, details);
    },
    log,
    warn: (message, details) => {
      log('warn', message, details);
    },
  };
};

export type { TelemetryAttributes, TelemetryAttributeValue, TraceIdentifiers, UnifiedServiceTags };
