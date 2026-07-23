import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { createDatadogProxy, createDatadogRequestContext } from '../src/proxy';

describe('createDatadogRequestContext', () => {
  it('preserves a valid incoming request ID', () => {
    const request = new NextRequest('https://example.com/checkout', {
      headers: {
        'x-request-id': 'upstream-123',
      },
    });

    const result = createDatadogRequestContext(request, {
      generateRequestId: () => 'generated-123',
    });

    expect(result.requestId).toBe('upstream-123');
    expect(result.headers.get('x-request-id')).toBe('upstream-123');
  });

  it('replaces invalid request IDs and supports a custom header', () => {
    const request = new NextRequest('https://example.com/checkout', {
      headers: {
        'x-correlation-id': 'contains spaces',
      },
    });

    const result = createDatadogRequestContext(request, {
      generateRequestId: () => 'generated-123',
      requestIdHeader: ' X-Correlation-ID ',
    });

    expect(result).toEqual(
      expect.objectContaining({
        requestId: 'generated-123',
        requestIdHeader: 'x-correlation-id',
      }),
    );
    expect(result.headers.get('x-correlation-id')).toBe('generated-123');
  });

  it('generates a UUID by default', () => {
    const request = new NextRequest('https://example.com/checkout');

    const result = createDatadogRequestContext(request);

    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('rejects invalid configuration and generated values', () => {
    const request = new NextRequest('https://example.com');

    expect(() =>
      createDatadogRequestContext(request, {
        requestIdHeader: 'invalid header',
      }),
    ).toThrow('Invalid HTTP header name');
    expect(() =>
      createDatadogRequestContext(request, {
        generateRequestId: () => 'invalid generated ID',
      }),
    ).toThrow('request ID generator returned an invalid value');
  });
});

describe('createDatadogProxy', () => {
  it('forwards and exposes the request ID by default', async () => {
    const request = new NextRequest('https://example.com/checkout');
    const proxy = createDatadogProxy({
      generateRequestId: () => 'req-123',
    });

    const response = await proxy(request, {} as never);

    expect(response.headers.get('x-request-id')).toBe('req-123');
    expect(response.headers.get('x-middleware-request-x-request-id')).toBe('req-123');
  });

  it('can keep the request ID internal', async () => {
    const request = new NextRequest('https://example.com/checkout');
    const proxy = createDatadogProxy({
      exposeRequestId: false,
      generateRequestId: () => 'req-123',
    });

    const response = await proxy(request, {} as never);

    expect(response.headers.get('x-request-id')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-request-id')).toBe('req-123');
  });
});
