import type { UnifiedServiceTags } from '../types';

const normalizeRequiredTag = (name: keyof UnifiedServiceTags, value: string): string => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`nextjs-datadog requires a non-empty ${name}`);
  }

  if (normalizedValue.length > 200) {
    throw new TypeError(`nextjs-datadog ${name} must not exceed 200 characters`);
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
