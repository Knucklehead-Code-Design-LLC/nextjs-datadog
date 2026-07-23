import { describe, expect, it } from 'vitest';

import { getRecordHeader, stripQueryAndFragment } from '../src/internal/request';

describe('request metadata normalization', () => {
  it('finds case-insensitive scalar and array headers', () => {
    expect(
      getRecordHeader(
        {
          Accept: 'application/json',
          'X-Request-ID': ['first', 'second'],
        },
        'x-request-id',
      ),
    ).toBe('first');
    expect(getRecordHeader({ Accept: 'application/json' }, 'x-request-id')).toBeUndefined();
  });

  it.each([
    ['/orders/123?token=secret', '/orders/123'],
    ['/orders/123#details', '/orders/123'],
    ['?token=secret', '/'],
    ['/orders/123', '/orders/123'],
  ])('removes sensitive URL data from %s', (path, expected) => {
    expect(stripQueryAndFragment(path)).toBe(expected);
  });

  it('bounds long paths', () => {
    expect(stripQueryAndFragment(`/${'a'.repeat(3_000)}`)).toHaveLength(2_048);
  });
});
