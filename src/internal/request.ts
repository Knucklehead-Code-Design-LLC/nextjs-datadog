const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PATH_LENGTH = 2_048;

export const DEFAULT_REQUEST_ID_HEADER = 'x-request-id';

export const normalizeHeaderName = (headerName: string): string => {
  const normalizedHeaderName = headerName.trim().toLowerCase();

  if (!HEADER_NAME_PATTERN.test(normalizedHeaderName)) {
    throw new TypeError(`Invalid HTTP header name: ${headerName}`);
  }

  return normalizedHeaderName;
};

export const normalizeRequestId = (requestId: string | undefined): string | undefined => {
  if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
    return undefined;
  }

  return requestId;
};

export const getRecordHeader = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
  headerName: string,
): string | undefined => {
  const normalizedHeaderName = headerName.toLowerCase();

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== normalizedHeaderName) {
      continue;
    }

    return Array.isArray(value) ? value[0] : value;
  }

  return undefined;
};

export const stripQueryAndFragment = (path: string): string => {
  const queryIndex = path.indexOf('?');
  const fragmentIndex = path.indexOf('#');
  const indexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const endIndex = indexes.length === 0 ? path.length : Math.min(...indexes);
  const pathWithoutQuery = path.slice(0, endIndex);

  return (pathWithoutQuery || '/').slice(0, MAX_PATH_LENGTH);
};
