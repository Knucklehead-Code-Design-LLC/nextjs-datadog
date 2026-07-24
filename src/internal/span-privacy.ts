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

const sanitizeUrlAttribute = (span: StartedSpan, attributeName: string): void => {
  const value = span.attributes[attributeName];
  if (typeof value === 'string') {
    span.setAttribute(attributeName, sanitizeTelemetryUrl(value));
  }
};

const sanitizeStartedSpan = (span: StartedSpan): void => {
  span.updateName(sanitizeTelemetrySpanName(span.name));
  sanitizeUrlAttribute(span, 'http.target');
  sanitizeUrlAttribute(span, 'http.url');
  sanitizeUrlAttribute(span, 'url.full');

  if (typeof span.attributes['url.query'] === 'string') {
    span.setAttribute('url.query', '[redacted]');
  }
};

const sanitizeEndedSpan = (span: EndedSpan): void => {
  const attributes = span.attributes;
  const route = attributes['http.route'];
  const method = attributes['http.request.method'] ?? attributes['http.method'];

  if (typeof route === 'string') {
    if (typeof attributes['http.target'] === 'string') {
      attributes['http.target'] = sanitizeTelemetryUrl(route);
    }

    if (typeof method === 'string') {
      (span as { name: string }).name = `${method} ${sanitizeTelemetryUrl(route)}`.slice(
        0,
        MAX_SPAN_NAME_LENGTH,
      );
    }
  }

  for (const attributeName of ['http.target', 'http.url', 'url.full']) {
    const value = attributes[attributeName];
    if (typeof value === 'string') {
      attributes[attributeName] = sanitizeTelemetryUrl(value);
    }
  }

  if (typeof attributes['url.query'] === 'string') {
    attributes['url.query'] = '[redacted]';
  }

  (span as { name: string }).name = sanitizeTelemetrySpanName(span.name);
};

export const createTelemetryPrivacySpanProcessor = (): SpanProcessor => {
  return {
    forceFlush: () => Promise.resolve(),
    onEnd: (span) => {
      try {
        sanitizeEndedSpan(span);
      } catch {
        // Privacy processing must not affect the application request.
      }
    },
    onStart: (span) => {
      sanitizeStartedSpan(span);
    },
    shutdown: () => Promise.resolve(),
  };
};
