import { datadogRum, type RumInitConfiguration, type RumPlugin } from '@datadog/browser-rum';
import {
  addNextjsError,
  DatadogAppRouter,
  DatadogPagesRouter,
  ErrorBoundary,
  nextjsPlugin,
  onRouterTransitionStart,
} from '@datadog/browser-rum-nextjs';

import { normalizeUnifiedServiceTags } from './internal/config';
import type { UnifiedServiceTags } from './types';

type AllowedTracingUrl = NonNullable<RumInitConfiguration['allowedTracingUrls']>[number];

export interface NextDatadogRumConfiguration
  extends
    Omit<RumInitConfiguration, 'env' | 'plugins' | 'service' | 'version'>,
    UnifiedServiceTags {
  /**
   * Additional Datadog-provided plugins. The Next.js plugin is added automatically.
   */
  plugins?: RumPlugin[];
  /**
   * Inject W3C trace context into same-origin fetch and XHR requests.
   *
   * @defaultValue true
   */
  traceSameOrigin?: boolean;
}

export interface NextDatadogRumInitializationResult {
  configuration: RumInitConfiguration;
  status: 'already-initialized' | 'initialized';
}

const isSameOrigin = (url: string): boolean => {
  if (typeof globalThis.location === 'undefined') {
    return false;
  }

  try {
    return new URL(url, globalThis.location.href).origin === globalThis.location.origin;
  } catch {
    return false;
  }
};

const createSameOriginTracingUrl = (): AllowedTracingUrl => ({
  match: isSameOrigin,
  propagatorTypes: ['tracecontext'],
});

export const createNextDatadogRumConfiguration = (
  options: NextDatadogRumConfiguration,
): RumInitConfiguration => {
  const {
    allowedTracingUrls = [],
    plugins = [],
    traceSameOrigin = true,
    ...rumConfiguration
  } = options;
  const tags = normalizeUnifiedServiceTags(options);
  const hasNextjsPlugin = plugins.some((plugin) => plugin.name === 'nextjs');

  return {
    ...rumConfiguration,
    allowedTracingUrls: [
      ...allowedTracingUrls,
      ...(traceSameOrigin ? [createSameOriginTracingUrl()] : []),
    ],
    env: tags.env,
    plugins: [...plugins, ...(hasNextjsPlugin ? [] : [nextjsPlugin()])],
    service: tags.service,
    version: tags.version,
  };
};

export const initNextDatadogRum = (
  options: NextDatadogRumConfiguration,
): NextDatadogRumInitializationResult => {
  const existingConfiguration = datadogRum.getInitConfiguration();
  if (existingConfiguration) {
    return {
      configuration: existingConfiguration,
      status: 'already-initialized',
    };
  }

  const configuration = createNextDatadogRumConfiguration(options);
  datadogRum.init(configuration);

  return {
    configuration,
    status: 'initialized',
  };
};

export {
  addNextjsError,
  DatadogAppRouter,
  DatadogPagesRouter,
  ErrorBoundary,
  onRouterTransitionStart,
};
export type { RumInitConfiguration, RumPlugin };
