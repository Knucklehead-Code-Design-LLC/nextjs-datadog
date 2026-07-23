import type { TelemetryAttributes, TelemetryAttributeValue } from '../types';

const ATTRIBUTE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const DEFAULT_ATTRIBUTE_LIMIT = 64;
const DEFAULT_STRING_LIMIT = 1_024;

interface NormalizeTelemetryAttributesOptions {
  attributeLimit?: number;
  reservedKeys?: ReadonlySet<string>;
  stringLimit?: number;
}

const normalizeAttributeValue = (
  value: TelemetryAttributeValue | null | undefined,
  stringLimit: number,
): TelemetryAttributeValue | undefined => {
  if (typeof value === 'string') {
    return value.slice(0, stringLimit);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  return typeof value === 'boolean' ? value : undefined;
};

export const normalizeTelemetryAttributes = (
  attributes: TelemetryAttributes | undefined,
  options: NormalizeTelemetryAttributesOptions = {},
): Record<string, TelemetryAttributeValue> => {
  if (!attributes) {
    return {};
  }

  const {
    attributeLimit = DEFAULT_ATTRIBUTE_LIMIT,
    reservedKeys = new Set<string>(),
    stringLimit = DEFAULT_STRING_LIMIT,
  } = options;
  const normalizedAttributes: Record<string, TelemetryAttributeValue> = {};
  let normalizedAttributeCount = 0;

  for (const [key, value] of Object.entries(attributes)) {
    if (
      normalizedAttributeCount >= attributeLimit ||
      !ATTRIBUTE_KEY_PATTERN.test(key) ||
      reservedKeys.has(key)
    ) {
      continue;
    }

    const normalizedValue = normalizeAttributeValue(value, stringLimit);
    if (normalizedValue !== undefined) {
      normalizedAttributes[key] = normalizedValue;
      normalizedAttributeCount += 1;
    }
  }

  return normalizedAttributes;
};
