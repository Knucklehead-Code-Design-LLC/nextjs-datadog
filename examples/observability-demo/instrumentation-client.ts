import { initNextDatadogRum } from 'nextjs-datadog/client';

const applicationId = process.env.NEXT_PUBLIC_DATADOG_APPLICATION_ID;
const clientToken = process.env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN;

if (applicationId && clientToken) {
  initNextDatadogRum({
    applicationId,
    clientToken,
    defaultPrivacyLevel: 'mask-user-input',
    env: 'demo',
    service: 'nextjs-observability-demo',
    sessionSampleRate: 100,
    site: 'datadoghq.com',
    traceSampleRate: 100,
    trackLongTasks: true,
    trackResources: true,
    trackUserInteractions: true,
    version: '1.0.0',
  });
}
