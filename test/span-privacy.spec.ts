import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { SpanKind } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';

import {
  createTelemetryPrivacySpanProcessor,
  redactTelemetryUrlPath,
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

  it('redacts concrete paths while retaining the outbound origin', () => {
    expect(
      redactTelemetryUrlPath(
        'https://user:secret@api.example.com/orders/customer@example.com?token=private#details',
      ),
    ).toBe('https://api.example.com/[redacted]');
    expect(redactTelemetryUrlPath('/orders/customer@example.com?token=private')).toBe(
      '/[redacted]',
    );
    expect(redactTelemetryUrlPath('https://api.example.com/')).toBe('https://api.example.com/');
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

  it('redacts outbound client paths before other processors observe them', () => {
    const setAttribute = vi.fn();
    const updateName = vi.fn();
    const processor = createTelemetryPrivacySpanProcessor();
    const span = {
      attributes: {
        'http.target': '/orders/customer@example.com?token=private',
        'http.url': 'https://api.example.com/orders/customer@example.com?token=private',
        'url.full': 'https://api.example.com/orders/customer@example.com?token=private',
        'url.path': '/orders/customer@example.com',
      },
      kind: SpanKind.CLIENT,
      name: 'http GET https://api.example.com/orders/customer@example.com?token=private',
      setAttribute,
      updateName,
    };

    processor.onStart(span as never, {} as never);

    expect(updateName).toHaveBeenCalledWith('http GET https://api.example.com/[redacted]');
    expect(setAttribute).toHaveBeenCalledWith('http.target', '/[redacted]');
    expect(setAttribute).toHaveBeenCalledWith('http.url', 'https://api.example.com/[redacted]');
    expect(setAttribute).toHaveBeenCalledWith('url.full', 'https://api.example.com/[redacted]');
    expect(setAttribute).toHaveBeenCalledWith('url.path', '/[redacted]');
  });

  it('redacts URL attributes added to outbound client spans after start', () => {
    const processor = createTelemetryPrivacySpanProcessor();
    const span = {
      attributes: {
        'http.target': '/orders/123?token=private',
        'http.url': 'https://api.example.com/orders/123?token=private',
        'url.full': 'https://api.example.com/orders/123?token=private',
        'url.path': '/orders/123',
      },
      kind: SpanKind.CLIENT,
      name: 'GET https://api.example.com/orders/123?token=private',
    };

    processor.onEnd(span as never);

    expect(span).toEqual({
      attributes: {
        'http.target': '/[redacted]',
        'http.url': 'https://api.example.com/[redacted]',
        'url.full': 'https://api.example.com/[redacted]',
        'url.path': '/[redacted]',
      },
      kind: SpanKind.CLIENT,
      name: 'GET https://api.example.com/[redacted]',
    });
  });

  it('can preserve known-safe outbound paths while still removing sensitive URL parts', () => {
    const processor = createTelemetryPrivacySpanProcessor({
      includeOutboundUrlPath: true,
    });
    const span = {
      attributes: {
        'http.url': 'https://api.example.com/health?token=private#details',
      },
      kind: SpanKind.CLIENT,
      name: 'GET https://api.example.com/health?token=private#details',
    };

    processor.onEnd(span as never);

    expect(span.attributes['http.url']).toBe('https://api.example.com/health');
    expect(span.name).toBe('GET https://api.example.com/health');
  });

  it('sanitizes attributes that instrumentation adds after span start', () => {
    const processor = createTelemetryPrivacySpanProcessor();
    const span = {
      attributes: {
        'http.method': 'GET',
        'http.route': '/orders/[id]',
        'http.target': '/orders/customer@example.com?token=private',
        'http.url': 'https://example.com/orders/customer@example.com?token=private',
        'url.path': '/orders/customer@example.com',
        'url.query': 'token=private',
      },
      kind: SpanKind.SERVER,
      name: 'GET /orders/customer@example.com?token=private',
    };

    processor.onEnd(span as never);

    expect(span).toEqual({
      attributes: {
        'http.method': 'GET',
        'http.route': '/orders/[id]',
        'http.target': '/orders/[id]',
        'http.url': 'https://example.com/orders/customer@example.com',
        'url.path': '/orders/[id]',
        'url.query': '[redacted]',
      },
      kind: SpanKind.SERVER,
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

  it('exports outbound client spans without concrete path identifiers by default', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [createTelemetryPrivacySpanProcessor(), new SimpleSpanProcessor(exporter)],
    });
    const span = provider
      .getTracer('privacy-test')
      .startSpan('GET https://api.example.com/orders/customer@example.com?token=private', {
        attributes: {
          'http.target': '/orders/customer@example.com?token=private',
          'url.full': 'https://api.example.com/orders/customer@example.com?token=private',
          'url.path': '/orders/customer@example.com',
        },
        kind: SpanKind.CLIENT,
      });

    span.end();

    const exportedSpan = exporter.getFinishedSpans()[0];
    expect(exportedSpan?.name).toBe('GET https://api.example.com/[redacted]');
    expect(exportedSpan?.attributes).toMatchObject({
      'http.target': '/[redacted]',
      'url.full': 'https://api.example.com/[redacted]',
      'url.path': '/[redacted]',
    });

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
