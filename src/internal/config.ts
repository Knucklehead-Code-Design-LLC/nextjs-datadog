import type { UnifiedServiceTags } from '../types';

const DATADOG_TAG_VALUE_PATTERN = /^[\p{L}0-9_.:/-]+$/u;

const normalizeRequiredTag = (name: keyof UnifiedServiceTags, value: string): string => {
  if (typeof value !== 'string') {
    throw new TypeError(`nextjs-datadog requires ${name} to be a string`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`nextjs-datadog requires a non-empty ${name}`);
  }

  if (normalizedValue.length > 200) {
    throw new TypeError(`nextjs-datadog ${name} must not exceed 200 characters`);
  }

  if (!DATADOG_TAG_VALUE_PATTERN.test(normalizedValue)) {
    throw new TypeError(
      `nextjs-datadog ${name} must contain only letters, numbers, underscores, periods, colons, slashes, or hyphens`,
    );
  }

  return normalizedValue;
};

export const normalizeUnifiedServiceTags = (
  tags: UnifiedServiceTags,
): Readonly<UnifiedServiceTags> => ({
  env: normalizeRequiredTag('env', tags.env),
  service: normalizeRequiredTag('service', tags.service),
  version: normalizeRequiredTag('version', tags.version),
});
