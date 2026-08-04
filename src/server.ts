import { context, isSpanContextValid, trace } from '@opentelemetry/api';

import { normalizeTelemetryAttributes } from './internal/attributes';
import { normalizeUnifiedServiceTags } from './internal/config';
import {
  serializeError,
  transformSerializedError,
  type SerializedError,
  type TransformError,
} from './internal/error';
import { TELEMETRY_DISTRO_NAME, TELEMETRY_DISTRO_VERSION } from './internal/package-metadata';
import { getSerializedError } from './internal/serialized-log-error';
import type {
  TelemetryAttributes,
  TelemetryAttributeValue,
  TraceIdentifiers,
  UnifiedServiceTags,
} from './types';

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
  'telemetry.distro.name',
  'telemetry.distro.version',
  'timestamp',
  'trace_id',
  'version',
]);

export type DatadogLogLevel = 'debug' | 'error' | 'info' | 'warn';

export { serializeError } from './internal/error';
export type { SerializedError } from './internal/error';

export interface DatadogLogRecord {
  [key: string]: unknown;
  env: string;
  error?: SerializedError;
  level: DatadogLogLevel;
  message: string;
  service: string;
  span_id?: string;
  status: DatadogLogLevel;
  'telemetry.distro.name'?: string;
  'telemetry.distro.version'?: string;
  timestamp: string;
  trace_id?: string;
  version: string;
}

export interface DatadogLogDetails {
  attributes?: TelemetryAttributes;
  error?: unknown;
  /**
   * Explicit correlation identifiers for logs emitted after an asynchronous
   * boundary. Values are validated before they are written.
   */
  traceIdentifiers?: TraceIdentifiers;
}

export type DatadogLogWriter = (level: DatadogLogLevel, record: Readonly<DatadogLogRecord>) => void;

export interface CreateDatadogLoggerOptions extends UnifiedServiceTags {
  clock?: () => Date;
  getTraceIdentifiers?: () => TraceIdentifiers | undefined;
  onWriteError?: (error: unknown) => void;
  transformError?: TransformError;
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
  details: DatadogLogDetails,
  transformError: CreateDatadogLoggerOptions['transformError'],
): SerializedError | undefined => {
  const serializedError = getSerializedError(details);
  if (serializedError) {
    return serializedError;
  }

  const { error } = details;
  if (error === undefined) {
    return undefined;
  }

  return transformSerializedError(serializeError(error), transformError);
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
    'telemetry.distro.name': TELEMETRY_DISTRO_NAME,
    'telemetry.distro.version': TELEMETRY_DISTRO_VERSION,
    timestamp: dependencies.clock().toISOString(),
    version: dependencies.tags.version,
  };

  let traceIdentifierSource = dependencies.getTraceIdentifiers;
  if (details.traceIdentifiers) {
    traceIdentifierSource = () => details.traceIdentifiers;
  }
  const traceIdentifiers = getCorrelatableTraceIdentifiers(traceIdentifierSource);
  if (traceIdentifiers) {
    record.span_id = traceIdentifiers.spanId;
    record.trace_id = traceIdentifiers.traceId;
  }

  const error = serializeLogError(details, dependencies.transformError);
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
