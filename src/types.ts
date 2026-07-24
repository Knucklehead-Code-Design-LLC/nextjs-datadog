export type TelemetryAttributeValue = boolean | number | string;

export type TelemetryAttributes = Readonly<
  Record<string, TelemetryAttributeValue | null | undefined>
>;

export interface UnifiedServiceTags {
  /**
   * Stable Datadog service name shared by RUM, traces, and logs.
   */
  service: string;
  /**
   * Deployment environment such as `production`, `preview`, or `development`.
   */
  env: string;
  /**
   * Deployable version, preferably the Git commit SHA.
   */
  version: string;
}

export interface DatadogDirectOtlpOptions {
  /**
   * Server-only Datadog API key. Never expose this value through a
   * `NEXT_PUBLIC_` variable or import the instrumentation entrypoint into
   * browser code.
   */
  apiKey: string;
  /**
   * Datadog site such as `us5.datadoghq.com`.
   */
  site: string;
}

export interface TraceIdentifiers {
  spanId: string;
  traceId: string;
}
