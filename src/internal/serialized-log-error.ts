import { normalizeSerializedError, type SerializedError } from './error';
import type { DatadogLogDetails } from '../server';

const SERIALIZED_ERROR = Symbol('nextjs-datadog.serialized-error');

type DatadogLogDetailsWithSerializedError = DatadogLogDetails & {
  [SERIALIZED_ERROR]?: SerializedError;
};

export const withSerializedError = (
  details: DatadogLogDetails,
  error: Readonly<SerializedError>,
): DatadogLogDetails => {
  const detailsWithSerializedError = { ...details } as DatadogLogDetailsWithSerializedError;
  Object.defineProperty(detailsWithSerializedError, SERIALIZED_ERROR, {
    enumerable: false,
    value: normalizeSerializedError(error),
  });

  return detailsWithSerializedError;
};

export const getSerializedError = (details: DatadogLogDetails): SerializedError | undefined => {
  return (details as DatadogLogDetailsWithSerializedError)[SERIALIZED_ERROR];
};
