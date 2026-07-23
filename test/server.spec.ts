import { context, ROOT_CONTEXT, trace, type Span, type SpanContext } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDatadogLogger,
  getActiveTraceIdentifiers,
  serializeError,
  type DatadogLogLevel,
  type DatadogLogRecord,
} from '../src/server';

const TRACE_ID = '0123456789abcdef0123456789abcdef';
const SPAN_ID = '0123456789abcdef';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createDatadogLogger', () => {
  it('writes structured logs with service tags, safe attributes, errors, and trace context', () => {
    const records: {
      level: DatadogLogLevel;
      record: Readonly<DatadogLogRecord>;
    }[] = [];
    const error = Object.assign(new Error('database unavailable'), {
      digest: 'next-error-digest',
    });
    const logger = createDatadogLogger({
      clock: () => new Date('2026-07-22T12:00:00.000Z'),
      env: 'production',
      getTraceIdentifiers: () => ({
        spanId: SPAN_ID,
        traceId: TRACE_ID,
      }),
      service: 'checkout-web',
      version: 'abcdef1',
      write: (level, record) => {
        records.push({ level, record });
      },
    });

    logger.error('Checkout failed', {
      attributes: {
        'customer.id': 'cus_123',
        'error.kind': 'CannotOverride',
        infinite: Number.POSITIVE_INFINITY,
        message: 'cannot override',
        'request.id': 'req_123',
      },
      error,
    });

    expect(records).toHaveLength(1);
    const result = records[0];
    expect(result?.level).toBe('error');
    expect(result?.record).toMatchObject({
      'customer.id': 'cus_123',
      env: 'production',
      level: 'error',
      message: 'Checkout failed',
      'request.id': 'req_123',
      service: 'checkout-web',
      span_id: SPAN_ID,
      status: 'error',
      timestamp: '2026-07-22T12:00:00.000Z',
      trace_id: TRACE_ID,
      version: 'abcdef1',
    });
    expect(result?.record.error).toMatchObject({
      digest: 'next-error-digest',
      kind: 'Error',
      message: 'database unavailable',
    });
    expect(result?.record.infinite).toBeUndefined();
    expect(result?.record['error.kind']).toBeUndefined();
  });

  it('supports every convenience log level', () => {
    const levels: DatadogLogLevel[] = [];
    const logger = createDatadogLogger({
      env: 'test',
      service: 'web',
      version: '1',
      write: (level) => {
        levels.push(level);
      },
    });

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');
    logger.log('info', 'explicit');

    expect(levels).toEqual(['debug', 'info', 'warn', 'error', 'info']);
  });

  it('writes JSON to the console when no writer is supplied', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logger = createDatadogLogger({
      clock: () => new Date('2026-07-22T12:00:00.000Z'),
      env: 'test',
      service: 'web',
      version: '1',
    });

    logger.debug('debug');
    logger.error('error');
    logger.info('info');
    logger.warn('warn');

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('"message":"debug"'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"message":"error"'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"message":"info"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"message":"warn"'));
  });

  it('bounds untrusted values and drops invalid attributes and trace identifiers', () => {
    const write = vi.fn();
    const logger = createDatadogLogger({
      env: 'test',
      getTraceIdentifiers: () => ({
        spanId: 'invalid',
        traceId: 'invalid',
      }),
      service: 'web',
      version: '1',
      write,
    });
    const attributes = Object.fromEntries(
      Array.from({ length: 70 }, (_, index) => [`valid.${String(index)}`, 'x'.repeat(2_000)]),
    );

    logger.info('m'.repeat(5_000), {
      attributes: {
        ...attributes,
        '0invalid': 'no',
        nullable: null,
      },
    });

    const record = write.mock.calls[0]?.[1] as DatadogLogRecord;
    expect(record.message).toHaveLength(4_096);
    expect(record.trace_id).toBeUndefined();
    expect(record.span_id).toBeUndefined();
    expect(record['0invalid']).toBeUndefined();
    expect(record.nullable).toBeUndefined();
    expect(record['valid.0']).toHaveLength(1_024);
    expect(Object.keys(record).filter((key) => key.startsWith('valid.'))).toHaveLength(64);
  });

  it('contains failures from telemetry callbacks', () => {
    const onWriteError = vi.fn(() => {
      throw new Error('secondary failure');
    });
    const logger = createDatadogLogger({
      clock: () => {
        throw new Error('clock failed');
      },
      env: 'test',
      onWriteError,
      service: 'web',
      version: '1',
    });

    expect(() => logger.error('application error')).not.toThrow();
    expect(onWriteError).toHaveBeenCalledWith(expect.objectContaining({ message: 'clock failed' }));
  });

  it('allows controlled error redaction', () => {
    const write = vi.fn();
    const logger = createDatadogLogger({
      env: 'test',
      service: 'web',
      transformError: ({ digest, kind }) => ({
        ...(digest ? { digest } : {}),
        kind,
        message: '[redacted]',
      }),
      version: '1',
      write,
    });

    logger.error('failed', { error: new Error('secret') });

    expect(write.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        error: {
          kind: 'Error',
          message: '[redacted]',
        },
      }),
    );
  });
});

describe('serializeError', () => {
  it('serializes non-Error thrown values', () => {
    expect(serializeError({ reason: 'bad' })).toEqual({
      kind: 'object',
      message: '[object Object]',
    });
  });

  it('bounds error messages, stacks, and digests', () => {
    const error = Object.assign(new Error('m'.repeat(5_000)), {
      digest: 'd'.repeat(300),
    });
    error.stack = 's'.repeat(40_000);

    const serialized = serializeError(error);

    expect(serialized.message).toHaveLength(4_096);
    expect(serialized.stack).toHaveLength(32_768);
    expect(serialized.digest).toHaveLength(256);
  });
});

describe('getActiveTraceIdentifiers', () => {
  it('reads valid identifiers from the active OpenTelemetry span', () => {
    const spanContext: SpanContext = {
      spanId: SPAN_ID,
      traceFlags: 1,
      traceId: TRACE_ID,
    };
    const span = trace.wrapSpanContext(spanContext);
    const activeContext = trace.setSpan(ROOT_CONTEXT, span);

    vi.spyOn(context, 'active').mockReturnValue(activeContext);

    expect(getActiveTraceIdentifiers()).toEqual({
      spanId: SPAN_ID,
      traceId: TRACE_ID,
    });
  });

  it('ignores an invalid active span context', () => {
    const span = {
      spanContext: () => ({
        spanId: '0'.repeat(16),
        traceFlags: 0,
        traceId: '0'.repeat(32),
      }),
    } as Span;
    const activeContext = trace.setSpan(ROOT_CONTEXT, span);

    vi.spyOn(context, 'active').mockReturnValue(activeContext);

    expect(getActiveTraceIdentifiers()).toBeUndefined();
  });
});
