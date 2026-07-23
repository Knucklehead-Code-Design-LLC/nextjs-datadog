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
});
