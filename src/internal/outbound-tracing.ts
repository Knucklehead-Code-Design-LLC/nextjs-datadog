const MAX_OUTBOUND_TRACING_ORIGIN_COUNT = 32;
const MAX_OUTBOUND_TRACING_ORIGIN_LENGTH = 2_048;

const isHttpOrigin = (url: URL): boolean => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  if (url.username || url.password) {
    return false;
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    return false;
  }

  return true;
};

const parseOutboundTracingOrigin = (origin: string): URL => {
  try {
    return new URL(origin);
  } catch {
    throw new TypeError(
      'nextjs-datadog outbound tracing origin must be an absolute HTTP(S) origin',
    );
  }
};

const normalizeOutboundTracingOrigin = (origin: string): string => {
  if (typeof origin !== 'string') {
    throw new TypeError('nextjs-datadog outbound tracing origins must be strings');
  }

  const normalizedOrigin = origin.trim();
  if (!normalizedOrigin || normalizedOrigin.length > MAX_OUTBOUND_TRACING_ORIGIN_LENGTH) {
    throw new TypeError(
      `nextjs-datadog outbound tracing origins must be between 1 and ${String(MAX_OUTBOUND_TRACING_ORIGIN_LENGTH)} characters`,
    );
  }

  const url = parseOutboundTracingOrigin(normalizedOrigin);
  if (!isHttpOrigin(url)) {
    throw new TypeError(
      'nextjs-datadog outbound tracing origin must be an absolute HTTP(S) origin without credentials, path, query, or fragment',
    );
  }

  return `${url.origin}/`;
};

export const normalizeOutboundTracingOrigins = (
  origins: readonly string[] | undefined,
): string[] => {
  if (!origins) {
    return [];
  }

  if (!Array.isArray(origins)) {
    throw new TypeError('nextjs-datadog outbound tracing origins must be an array');
  }

  if (origins.length > MAX_OUTBOUND_TRACING_ORIGIN_COUNT) {
    throw new TypeError(
      `nextjs-datadog accepts at most ${String(MAX_OUTBOUND_TRACING_ORIGIN_COUNT)} outbound tracing origins`,
    );
  }

  return [...new Set(origins.map(normalizeOutboundTracingOrigin))];
};
