import { describe, expect, it } from 'vitest';

import { defineUnifiedServiceTags } from '../src';

describe('defineUnifiedServiceTags', () => {
  it('normalizes unified service tags', () => {
    expect(
      defineUnifiedServiceTags({
        env: ' production ',
        service: ' checkout-web ',
        version: ' abc123 ',
      }),
    ).toEqual({
      env: 'production',
      service: 'checkout-web',
      version: 'abc123',
    });
  });

  it.each([
    ['env', { env: ' ', service: 'web', version: '1' }],
    ['service', { env: 'test', service: '', version: '1' }],
    ['version', { env: 'test', service: 'web', version: '\n' }],
  ] as const)('rejects an empty %s', (name, tags) => {
    expect(() => defineUnifiedServiceTags(tags)).toThrow(`non-empty ${name}`);
  });

  it('rejects oversized tags', () => {
    expect(() =>
      defineUnifiedServiceTags({
        env: 'test',
        service: 's'.repeat(201),
        version: '1',
      }),
    ).toThrow('service must not exceed 200 characters');
  });

  it.each(['checkout web', 'production,west', '🔥'])(
    'rejects a tag value that Datadog would normalize inconsistently: %s',
    (service) => {
      expect(() =>
        defineUnifiedServiceTags({
          env: 'test',
          service,
          version: '1',
        }),
      ).toThrow('service must contain only');
    },
  );

  it('rejects non-string tags at runtime', () => {
    expect(() =>
      defineUnifiedServiceTags({
        env: 'test',
        service: undefined as never,
        version: '1',
      }),
    ).toThrow('service to be a string');
  });
});
