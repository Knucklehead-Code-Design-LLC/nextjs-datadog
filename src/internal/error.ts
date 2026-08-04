const MAX_ERROR_MESSAGE_LENGTH = 4_096;
const MAX_ERROR_DIGEST_LENGTH = 256;
const MAX_ERROR_KIND_LENGTH = 256;
const MAX_ERROR_STACK_LENGTH = 32_768;

export interface SerializedError {
  digest?: string;
  kind: string;
  message: string;
  stack?: string;
}

export type TransformError = (error: Readonly<SerializedError>) => SerializedError;

const safeStringify = (value: unknown): string => {
  try {
    return String(value);
  } catch {
    return '[unserializable thrown value]';
  }
};

const normalizeErrorField = (value: unknown, fallback: string, maximumLength: number): string => {
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }

  return value.slice(0, maximumLength);
};

export const normalizeSerializedError = (error: unknown): SerializedError => {
  if (!error || typeof error !== 'object') {
    return {
      kind: 'Error',
      message: '[invalid transformed error]',
    };
  }

  const candidate = error as Partial<SerializedError>;
  const normalizedError: SerializedError = {
    kind: normalizeErrorField(candidate.kind, 'Error', MAX_ERROR_KIND_LENGTH),
    message: normalizeErrorField(
      candidate.message,
      '[invalid transformed error]',
      MAX_ERROR_MESSAGE_LENGTH,
    ),
  };

  if (typeof candidate.digest === 'string' && candidate.digest.length > 0) {
    normalizedError.digest = candidate.digest.slice(0, MAX_ERROR_DIGEST_LENGTH);
  }

  if (typeof candidate.stack === 'string' && candidate.stack.length > 0) {
    normalizedError.stack = candidate.stack.slice(0, MAX_ERROR_STACK_LENGTH);
  }

  return normalizedError;
};

export const serializeError = (error: unknown): SerializedError => {
  if (!(error instanceof Error)) {
    return {
      kind: typeof error,
      message: safeStringify(error).slice(0, MAX_ERROR_MESSAGE_LENGTH),
    };
  }

  const serializedError: SerializedError = {
    kind: normalizeErrorField(error.name, 'Error', MAX_ERROR_KIND_LENGTH),
    message: normalizeErrorField(error.message, '', MAX_ERROR_MESSAGE_LENGTH),
  };

  if ('digest' in error && typeof error.digest === 'string' && error.digest.length > 0) {
    serializedError.digest = error.digest.slice(0, MAX_ERROR_DIGEST_LENGTH);
  }

  if (error.stack) {
    serializedError.stack = error.stack.slice(0, MAX_ERROR_STACK_LENGTH);
  }

  return serializedError;
};

export const transformSerializedError = (
  error: Readonly<SerializedError>,
  transformError: TransformError | undefined,
): SerializedError => {
  if (!transformError) {
    return { ...error };
  }

  return normalizeSerializedError(transformError(error));
};
