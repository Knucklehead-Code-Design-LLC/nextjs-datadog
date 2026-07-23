import { createNextDatadogInstrumentation } from 'nextjs-datadog/instrumentation';

import { demoLogger } from './lib/demo-logger';
import { demoTags } from './lib/demo-config';
import { createPreviewSpanProcessor } from './lib/preview-exporter';

const trustedBackendOrigin = process.env.DEMO_TRUSTED_BACKEND_ORIGIN;
const outboundTracingOrigins: string[] = [];

if (trustedBackendOrigin) {
  outboundTracingOrigins.push(trustedBackendOrigin);
}

const instrumentation = createNextDatadogInstrumentation({
  ...demoTags,
  includeUrlPath: true,
  logger: demoLogger,
  otel: {
    spanProcessors: ['auto', createPreviewSpanProcessor()],
  },
  outboundTracingOrigins,
  resourceAttributes: {
    'deployment.platform': 'local_demo',
  },
});

export const onRequestError = instrumentation.onRequestError;
export const register = instrumentation.register;
