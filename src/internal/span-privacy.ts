import { SpanKind } from '@opentelemetry/api';
import type { Configuration as VercelOtelConfiguration } from '@vercel/otel';

type SpanProcessor = Exclude<
  NonNullable<VercelOtelConfiguration['spanProcessors']>[number],
  string
>;
type StartedSpan = Parameters<SpanProcessor['onStart']>[0];
type EndedSpan = Parameters<SpanProcessor['onEnd']>[0];

const HTTP_URL_PATTERN = /https?:\/\/[^\s]+/gu;
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

export const sanitizeTelemetrySpanName = (name: string): string => {
  return name
    .replace(HTTP_URL_PATTERN, (url) => sanitizeTelemetryUrl(url))
    .slice(0, MAX_SPAN_NAME_LENGTH);
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

const sanitizeTelemetrySpanNameWithPathPolicy = (name: string, redactPath: boolean): string => {
  return name
    .replace(HTTP_URL_PATTERN, (url) => sanitizeUrlWithPathPolicy(url, redactPath))
    .slice(0, MAX_SPAN_NAME_LENGTH);
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
  const redactPath = span.kind === SpanKind.CLIENT && !includeOutboundUrlPath;
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
  if (typeof method === 'string') {
    (span as { name: string }).name = `${method} ${sanitizedRoute}`.slice(0, MAX_SPAN_NAME_LENGTH);
  }
};

const sanitizeEndedSpan = (span: EndedSpan, includeOutboundUrlPath: boolean): void => {
  applyParameterizedRoute(span);

  const attributes = span.attributes;
  const redactPath = span.kind === SpanKind.CLIENT && !includeOutboundUrlPath;

  for (const attributeName of URL_ATTRIBUTE_NAMES) {
    const value = attributes[attributeName];
    if (typeof value === 'string') {
      attributes[attributeName] = sanitizeUrlWithPathPolicy(value, redactPath);
    }
  }

  if (typeof attributes['url.query'] === 'string') {
    attributes['url.query'] = '[redacted]';
  }

  (span as { name: string }).name = sanitizeTelemetrySpanNameWithPathPolicy(span.name, redactPath);
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
      sanitizeStartedSpan(span, includeOutboundUrlPath);
    },
    shutdown: () => Promise.resolve(),
  };
};
