import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server.js';

import {
  DEFAULT_REQUEST_ID_HEADER,
  normalizeHeaderName,
  normalizeRequestId,
} from './internal/request';

export interface DatadogRequestContext {
  headers: Headers;
  requestId: string;
  requestIdHeader: string;
}

export interface DatadogRequestContextOptions {
  generateRequestId?: () => string;
  requestIdHeader?: string;
}

export interface CreateDatadogProxyOptions extends DatadogRequestContextOptions {
  /**
   * Return the request identifier to the caller as a response header.
   *
   * @defaultValue true
   */
  exposeRequestId?: boolean;
}

export type NextDatadogProxy = (
  request: NextRequest,
  event: NextFetchEvent,
) => NextResponse | Promise<NextResponse>;

const defaultRequestIdGenerator = (): string => globalThis.crypto.randomUUID();

const createGeneratedRequestId = (generateRequestId: () => string): string => {
  const requestId = normalizeRequestId(generateRequestId());

  if (!requestId) {
    throw new TypeError('nextjs-datadog request ID generator returned an invalid value');
  }

  return requestId;
};

export const createDatadogRequestContext = (
  request: Pick<NextRequest, 'headers'>,
  options: DatadogRequestContextOptions = {},
): DatadogRequestContext => {
  const requestIdHeader = normalizeHeaderName(options.requestIdHeader ?? DEFAULT_REQUEST_ID_HEADER);
  const generateRequestId = options.generateRequestId ?? defaultRequestIdGenerator;
  const headers = new Headers(request.headers);
  const requestId =
    normalizeRequestId(headers.get(requestIdHeader) ?? undefined) ??
    createGeneratedRequestId(generateRequestId);

  headers.set(requestIdHeader, requestId);

  return {
    headers,
    requestId,
    requestIdHeader,
  };
};

export const createDatadogProxy = (options: CreateDatadogProxyOptions = {}): NextDatadogProxy => {
  const exposeRequestId = options.exposeRequestId ?? true;

  return (request) => {
    const requestContext = createDatadogRequestContext(request, options);
    const response = NextResponse.next({
      request: {
        headers: requestContext.headers,
      },
    });

    if (exposeRequestId) {
      response.headers.set(requestContext.requestIdHeader, requestContext.requestId);
    }

    return response;
  };
};
