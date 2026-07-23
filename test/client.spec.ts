import type { RumInitConfiguration } from '@datadog/browser-rum';
import type * as BrowserRum from '@datadog/browser-rum';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rumMocks = vi.hoisted(() => ({
  getInitConfiguration: vi.fn<() => RumInitConfiguration | undefined>(),
  init: vi.fn<(configuration: RumInitConfiguration) => void>(),
}));

vi.mock('@datadog/browser-rum', async (importOriginal) => {
  const original = await importOriginal<typeof BrowserRum>();

  return {
    ...original,
    datadogRum: {
      ...original.datadogRum,
      getInitConfiguration: rumMocks.getInitConfiguration,
      init: rumMocks.init,
    },
  };
});

import {
  createNextDatadogRumConfiguration,
  initNextDatadogRum,
  type RumPlugin,
} from '../src/client';

const baseConfiguration = {
  applicationId: 'application-id',
  clientToken: 'client-token',
  env: 'production',
  service: 'checkout-web',
  sessionSampleRate: 100,
  version: 'abcdef1',
};

beforeEach(() => {
  rumMocks.getInitConfiguration.mockReturnValue(undefined);
});

describe('createNextDatadogRumConfiguration', () => {
  it('adds Next.js support and W3C same-origin trace propagation', () => {
    const configuration = createNextDatadogRumConfiguration(baseConfiguration);

    expect(configuration.plugins?.map((plugin) => plugin.name)).toContain('nextjs');
    expect(configuration.allowedTracingUrls).toHaveLength(1);

    const matcher = configuration.allowedTracingUrls?.[0];
    expect(matcher).toEqual(
      expect.objectContaining({
        propagatorTypes: ['tracecontext'],
      }),
    );
    if (typeof matcher === 'object' && 'match' in matcher && typeof matcher.match === 'function') {
      expect(matcher.match('/api/orders')).toBe(false);
      vi.stubGlobal('location', new URL('https://app.example.com/checkout'));
      expect(matcher.match('/api/orders')).toBe(true);
      expect(matcher.match('https://api.example.com/orders')).toBe(false);
      expect(matcher.match('http://[')).toBe(false);
      vi.unstubAllGlobals();
    }
  });

  it('preserves tracing rules and does not duplicate an existing Next.js plugin', () => {
    const nextPlugin: RumPlugin = {
      name: 'nextjs',
      onInit: vi.fn(),
    };
    const configuration = createNextDatadogRumConfiguration({
      ...baseConfiguration,
      allowedTracingUrls: ['https://api.example.com'],
      plugins: [nextPlugin],
      traceSameOrigin: false,
    });

    expect(configuration.allowedTracingUrls).toEqual(['https://api.example.com']);
    expect(configuration.plugins).toEqual([nextPlugin]);
  });
});

describe('initNextDatadogRum', () => {
  it('initializes Datadog once', () => {
    const result = initNextDatadogRum(baseConfiguration);

    expect(result.status).toBe('initialized');
    expect(rumMocks.init).toHaveBeenCalledOnce();
    expect(rumMocks.init).toHaveBeenCalledWith(result.configuration);
  });

  it('returns the existing configuration without reinitializing', () => {
    const existingConfiguration = {
      applicationId: 'existing-app',
      clientToken: 'existing-token',
    } as RumInitConfiguration;
    rumMocks.getInitConfiguration.mockReturnValue(existingConfiguration);

    const result = initNextDatadogRum(baseConfiguration);

    expect(result).toEqual({
      configuration: existingConfiguration,
      status: 'already-initialized',
    });
    expect(rumMocks.init).not.toHaveBeenCalled();
  });
});
