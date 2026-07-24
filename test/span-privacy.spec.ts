import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, vi } from 'vitest';

import {
  createTelemetryPrivacySpanProcessor,
  sanitizeTelemetrySpanName,
  sanitizeTelemetryUrl,
} from '../src/internal/span-privacy';

describe('telemetry span privacy', () => {
  it('removes credentials, query strings, and fragments from absolute URLs', () => {
    expect(
      sanitizeTelemetryUrl('https://user:secret@api.example.com/orders/123?token=private#details'),
    ).toBe('https://api.example.com/orders/123');
  });

  it('removes query strings and fragments from relative HTTP targets', () => {
    expect(sanitizeTelemetryUrl('/orders/123?token=private#details')).toBe('/orders/123');
  });

  it('sanitizes fetch and Axios URLs embedded in span names', () => {
    expect(
      sanitizeTelemetrySpanName(
        'http GET https://api.example.com/orders/123?token=private#details',
      ),
    ).toBe('http GET https://api.example.com/orders/123');
  });

  it('bounds unusually large span names and URL attributes', () => {
    expect(sanitizeTelemetrySpanName('s'.repeat(1_000))).toHaveLength(512);
    expect(sanitizeTelemetryUrl(`/${'p'.repeat(3_000)}`)).toHaveLength(2_048);
  });

  it('sanitizes URL attributes before other processors export the span', async () => {
    const setAttribute = vi.fn();
    const updateName = vi.fn();
    const processor = createTelemetryPrivacySpanProcessor();
    const span = {
      attributes: {
        'http.target': '/orders?token=private',
        'http.url': 'https://api.example.com/orders?token=private',
        'url.query': 'token=private',
      },
      name: 'http GET https://api.example.com/orders?token=private',
      setAttribute,
      updateName,
    };

    processor.onStart(span as never, {} as never);

    expect(updateName).toHaveBeenCalledWith('http GET https://api.example.com/orders');
    expect(setAttribute).toHaveBeenCalledWith('http.target', '/orders');
    expect(setAttribute).toHaveBeenCalledWith('http.url', 'https://api.example.com/orders');
    expect(setAttribute).toHaveBeenCalledWith('url.query', '[redacted]');

    processor.onEnd({} as never);
    await expect(processor.forceFlush()).resolves.toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });

  it('sanitizes attributes that instrumentation adds after span start', () => {
    const processor = createTelemetryPrivacySpanProcessor();
    const span = {
      attributes: {
        'http.method': 'GET',
        'http.route': '/orders/[id]',
        'http.target': '/orders/customer@example.com?token=private',
        'http.url': 'https://example.com/orders/customer@example.com?token=private',
        'url.query': 'token=private',
      },
      name: 'GET /orders/customer@example.com?token=private',
    };

    processor.onEnd(span as never);

    expect(span).toEqual({
      attributes: {
        'http.method': 'GET',
        'http.route': '/orders/[id]',
        'http.target': '/orders/[id]',
        'http.url': 'https://example.com/orders/customer@example.com',
        'url.query': '[redacted]',
      },
      name: 'GET /orders/[id]',
    });
  });

  it('sanitizes a completed SDK span before the next processor exports it', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [createTelemetryPrivacySpanProcessor(), new SimpleSpanProcessor(exporter)],
    });
    const span = provider
      .getTracer('privacy-test')
      .startSpan('GET /orders/customer@example.com?token=private');

    span.setAttributes({
      'http.method': 'GET',
      'http.route': '/orders/[id]',
      'http.target': '/orders/customer@example.com?token=private',
      'url.query': 'token=private',
    });
    span.end();

    const exportedSpan = exporter.getFinishedSpans()[0];
    expect(exportedSpan?.name).toBe('GET /orders/[id]');
    expect(exportedSpan?.attributes['http.target']).toBe('/orders/[id]');
    expect(exportedSpan?.attributes['url.query']).toBe('[redacted]');

    await provider.shutdown();
  });

  it('contains sanitization failures during span completion', () => {
    const processor = createTelemetryPrivacySpanProcessor();
    const span = {
      attributes: Object.freeze({
        'url.query': 'token=private',
      }),
      name: 'GET /orders?token=private',
    };

    expect(() => processor.onEnd(span as never)).not.toThrow();
  });
});
