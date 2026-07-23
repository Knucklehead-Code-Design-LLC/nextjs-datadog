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
const MAX_ERROR_DIGEST_LENGTH = 256;
const MAX_ERROR_KIND_LENGTH = 256;
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

const safeStringify = (value: unknown): string => {
  try {
    return String(value);
  } catch {
    return '[unserializable thrown value]';
  }
};

const normalizeErrorField = (value: unknown, fallback: string, maximumLength: number): string => {
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }

  return value.slice(0, maximumLength);
};

const normalizeSerializedError = (error: unknown): SerializedError => {
  if (!error || typeof error !== 'object') {
    return {
      kind: 'Error',
      message: '[invalid transformed error]',
    };
  }

  const candidate = error as Partial<SerializedError>;
  const normalizedError: SerializedError = {
    kind: normalizeErrorField(candidate.kind, 'Error', MAX_ERROR_KIND_LENGTH),
    message: normalizeErrorField(
      candidate.message,
      '[invalid transformed error]',
      MAX_ERROR_MESSAGE_LENGTH,
    ),
  };

  if (typeof candidate.digest === 'string' && candidate.digest.length > 0) {
    normalizedError.digest = candidate.digest.slice(0, MAX_ERROR_DIGEST_LENGTH);
  }

  if (typeof candidate.stack === 'string' && candidate.stack.length > 0) {
    normalizedError.stack = candidate.stack.slice(0, MAX_ERROR_STACK_LENGTH);
  }

  return normalizedError;
};

export const serializeError = (error: unknown): SerializedError => {
  if (!(error instanceof Error)) {
    return {
      kind: typeof error,
      message: safeStringify(error).slice(0, MAX_ERROR_MESSAGE_LENGTH),
    };
  }

  const serializedError: SerializedError = {
    kind: normalizeErrorField(error.name, 'Error', MAX_ERROR_KIND_LENGTH),
    message: normalizeErrorField(error.message, '', MAX_ERROR_MESSAGE_LENGTH),
  };

  if ('digest' in error && typeof error.digest === 'string' && error.digest.length > 0) {
    serializedError.digest = error.digest.slice(0, MAX_ERROR_DIGEST_LENGTH);
  }

  if (error.stack) {
    serializedError.stack = error.stack.slice(0, MAX_ERROR_STACK_LENGTH);
  }

  return serializedError;
};

const getCorrelatableTraceIdentifiers = (
  getTraceIdentifiers: () => TraceIdentifiers | undefined,
): TraceIdentifiers | undefined => {
  const traceIdentifiers = getTraceIdentifiers();
  if (!traceIdentifiers) {
    return undefined;
  }

  if (!SPAN_ID_PATTERN.test(traceIdentifiers.spanId)) {
    return undefined;
  }

  if (!TRACE_ID_PATTERN.test(traceIdentifiers.traceId)) {
    return undefined;
  }

  return traceIdentifiers;
};

const serializeLogError = (
  error: unknown,
  transformError: CreateDatadogLoggerOptions['transformError'],
): SerializedError | undefined => {
  if (error === undefined) {
    return undefined;
  }

  const serializedError = serializeError(error);
  if (!transformError) {
    return serializedError;
  }

  return normalizeSerializedError(transformError(serializedError));
};

interface LogRecordDependencies {
  clock: () => Date;
  getTraceIdentifiers: () => TraceIdentifiers | undefined;
  tags: Readonly<UnifiedServiceTags>;
  transformError: CreateDatadogLoggerOptions['transformError'];
}

const createLogRecord = (
  level: DatadogLogLevel,
  message: string,
  details: DatadogLogDetails,
  dependencies: LogRecordDependencies,
): DatadogLogRecord => {
  const attributes = normalizeTelemetryAttributes(details.attributes, {
    reservedKeys: RESERVED_LOG_KEYS,
  });
  const record: DatadogLogRecord = {
    ...attributes,
    env: dependencies.tags.env,
    level,
    message: message.slice(0, MAX_LOG_MESSAGE_LENGTH),
    service: dependencies.tags.service,
    status: level,
    timestamp: dependencies.clock().toISOString(),
    version: dependencies.tags.version,
  };

  const traceIdentifiers = getCorrelatableTraceIdentifiers(dependencies.getTraceIdentifiers);
  if (traceIdentifiers) {
    record.span_id = traceIdentifiers.spanId;
    record.trace_id = traceIdentifiers.traceId;
  }

  const error = serializeLogError(details.error, dependencies.transformError);
  if (error) {
    record.error = error;
  }

  return record;
};

const reportWriteError = (
  onWriteError: CreateDatadogLoggerOptions['onWriteError'],
  error: unknown,
): void => {
  try {
    onWriteError?.(error);
  } catch {
    // Telemetry delivery must not break the application.
  }
};

export const createDatadogLogger = (options: CreateDatadogLoggerOptions): DatadogLogger => {
  const dependencies: LogRecordDependencies = {
    clock: options.clock ?? (() => new Date()),
    getTraceIdentifiers: options.getTraceIdentifiers ?? getActiveTraceIdentifiers,
    tags: normalizeUnifiedServiceTags(options),
    transformError: options.transformError,
  };
  const write = options.write ?? defaultWriter;

  const log = (level: DatadogLogLevel, message: string, details: DatadogLogDetails = {}): void => {
    try {
      write(level, createLogRecord(level, message, details, dependencies));
    } catch (error) {
      reportWriteError(options.onWriteError, error);
    }
  };

  const debug: DatadogLogger['debug'] = (message, details) => {
    log('debug', message, details);
  };
  const error: DatadogLogger['error'] = (message, details) => {
    log('error', message, details);
  };
  const info: DatadogLogger['info'] = (message, details) => {
    log('info', message, details);
  };
  const warn: DatadogLogger['warn'] = (message, details) => {
    log('warn', message, details);
  };

  return { debug, error, info, log, warn };
};

export type { TelemetryAttributes, TelemetryAttributeValue, TraceIdentifiers, UnifiedServiceTags };
