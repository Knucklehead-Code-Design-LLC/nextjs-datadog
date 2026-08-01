import { SpanKind } from '@opentelemetry/api';
import type { Configuration as VercelOtelConfiguration } from '@vercel/otel';

type SpanProcessor = Exclude<
  NonNullable<VercelOtelConfiguration['spanProcessors']>[number],
  string
>;
type StartedSpan = Parameters<SpanProcessor['onStart']>[0];
type EndedSpan = Parameters<SpanProcessor['onEnd']>[0];

const HTTP_URL_PATTERN = /https?:\/\/[^\s]+/gu;
const RELATIVE_HTTP_TARGET_PATTERN = /(^|\s)(\/[^\s]*)/gu;
const MAX_SPAN_NAME_LENGTH = 512;
const MAX_URL_ATTRIBUTE_LENGTH = 2_048;
const REDACTED_PATH = '/[redacted]';
const URL_ATTRIBUTE_NAMES = ['http.target', 'http.url', 'url.full', 'url.path'] as const;

interface TelemetryPrivacySpanProcessorOptions {
  includeOutboundUrlPath?: boolean;
}

export const sanitizeTelemetryUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, MAX_URL_ATTRIBUTE_LENGTH);
  } catch {
    const queryIndex = value.indexOf('?');
    const fragmentIndex = value.indexOf('#');
    const indexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
    let endIndex = value.length;

    if (indexes.length > 0) {
      endIndex = Math.min(...indexes);
    }

    return value.slice(0, endIndex).slice(0, MAX_URL_ATTRIBUTE_LENGTH);
  }
};

export const redactTelemetryUrlPath = (value: string): string => {
  const sanitizedValue = sanitizeTelemetryUrl(value);

  try {
    const url = new URL(sanitizedValue);
    if (url.pathname === '/' || url.pathname === '') {
      return url.toString().slice(0, MAX_URL_ATTRIBUTE_LENGTH);
    }

    url.pathname = REDACTED_PATH;
    return url.toString().slice(0, MAX_URL_ATTRIBUTE_LENGTH);
  } catch {
    if (sanitizedValue.startsWith('/') && sanitizedValue !== '/') {
      return REDACTED_PATH;
    }

    return sanitizedValue;
  }
};

const sanitizeUrlWithPathPolicy = (value: string, redactPath: boolean): string => {
  if (redactPath) {
    return redactTelemetryUrlPath(value);
  }

  return sanitizeTelemetryUrl(value);
};

const hasParameterizedRoute = (span: Pick<EndedSpan, 'attributes'>): boolean => {
  const route = span.attributes['http.route'];

  return typeof route === 'string' && route.length > 0;
};

const shouldRedactStartedSpanPath = (
  span: Pick<StartedSpan, 'kind'>,
  includeOutboundUrlPath: boolean,
): boolean => {
  if (span.kind === SpanKind.CLIENT) {
    return !includeOutboundUrlPath;
  }

  return span.kind === SpanKind.SERVER;
};

const shouldRedactEndedSpanNamePath = (
  span: EndedSpan,
  includeOutboundUrlPath: boolean,
): boolean => {
  if (span.kind === SpanKind.CLIENT) {
    return !includeOutboundUrlPath;
  }

  return span.kind === SpanKind.SERVER && !hasParameterizedRoute(span);
};

const shouldRedactEndedUrlAttributePath = (
  span: EndedSpan,
  attributeName: (typeof URL_ATTRIBUTE_NAMES)[number],
  includeOutboundUrlPath: boolean,
): boolean => {
  if (span.kind === SpanKind.CLIENT) {
    return !includeOutboundUrlPath;
  }

  if (span.kind !== SpanKind.SERVER) {
    return false;
  }

  if (!hasParameterizedRoute(span)) {
    return true;
  }

  return attributeName === 'http.url' || attributeName === 'url.full';
};

const sanitizeTelemetrySpanNameWithUrlPolicy = (
  name: string,
  sanitizeUrl: (url: string) => string,
): string => {
  return name
    .replace(HTTP_URL_PATTERN, (url) => sanitizeUrl(url))
    .replace(RELATIVE_HTTP_TARGET_PATTERN, (_target, prefix: string, url: string) => {
      return `${prefix}${sanitizeUrl(url)}`;
    })
    .slice(0, MAX_SPAN_NAME_LENGTH);
};

export const sanitizeTelemetrySpanName = (name: string): string => {
  return sanitizeTelemetrySpanNameWithUrlPolicy(name, sanitizeTelemetryUrl);
};

const sanitizeTelemetrySpanNameWithPathPolicy = (name: string, redactPath: boolean): string => {
  return sanitizeTelemetrySpanNameWithUrlPolicy(name, (url) => {
    return sanitizeUrlWithPathPolicy(url, redactPath);
  });
};

const sanitizeUrlAttribute = (
  span: StartedSpan,
  attributeName: string,
  redactPath: boolean,
): void => {
  const value = span.attributes[attributeName];
  if (typeof value === 'string') {
    span.setAttribute(attributeName, sanitizeUrlWithPathPolicy(value, redactPath));
  }
};

const sanitizeStartedSpan = (span: StartedSpan, includeOutboundUrlPath: boolean): void => {
  const redactPath = shouldRedactStartedSpanPath(span, includeOutboundUrlPath);
  span.updateName(sanitizeTelemetrySpanNameWithPathPolicy(span.name, redactPath));

  for (const attributeName of URL_ATTRIBUTE_NAMES) {
    sanitizeUrlAttribute(span, attributeName, redactPath);
  }

  if (typeof span.attributes['url.query'] === 'string') {
    span.setAttribute('url.query', '[redacted]');
  }
};

const applyParameterizedRoute = (span: EndedSpan): void => {
  const attributes = span.attributes;
  const route = attributes['http.route'];
  if (typeof route !== 'string') {
    return;
  }

  const sanitizedRoute = sanitizeTelemetryUrl(route);
  if (typeof attributes['http.target'] === 'string') {
    attributes['http.target'] = sanitizedRoute;
  }

  if (typeof attributes['url.path'] === 'string') {
    attributes['url.path'] = sanitizedRoute;
  }

  const method = attributes['http.request.method'] ?? attributes['http.method'];
  let name = sanitizedRoute;
  if (typeof method === 'string') {
    name = `${method} ${sanitizedRoute}`;
  }

  (span as { name: string }).name = name.slice(0, MAX_SPAN_NAME_LENGTH);
};

const sanitizeEndedSpan = (span: EndedSpan, includeOutboundUrlPath: boolean): void => {
  applyParameterizedRoute(span);

  const attributes = span.attributes;

  for (const attributeName of URL_ATTRIBUTE_NAMES) {
    const value = attributes[attributeName];
    if (typeof value === 'string') {
      attributes[attributeName] = sanitizeUrlWithPathPolicy(
        value,
        shouldRedactEndedUrlAttributePath(span, attributeName, includeOutboundUrlPath),
      );
    }
  }

  if (typeof attributes['url.query'] === 'string') {
    attributes['url.query'] = '[redacted]';
  }

  (span as { name: string }).name = sanitizeTelemetrySpanNameWithPathPolicy(
    span.name,
    shouldRedactEndedSpanNamePath(span, includeOutboundUrlPath),
  );
};

export const createTelemetryPrivacySpanProcessor = (
  options: TelemetryPrivacySpanProcessorOptions = {},
): SpanProcessor => {
  const includeOutboundUrlPath = options.includeOutboundUrlPath === true;

  return {
    forceFlush: () => Promise.resolve(),
    onEnd: (span) => {
      try {
        sanitizeEndedSpan(span, includeOutboundUrlPath);
      } catch {
        // Privacy processing must not affect the application request.
      }
    },
    onStart: (span) => {
      try {
        sanitizeStartedSpan(span, includeOutboundUrlPath);
      } catch {
        // Privacy processing must not affect the application request.
      }
    },
    shutdown: () => Promise.resolve(),
  };
};
