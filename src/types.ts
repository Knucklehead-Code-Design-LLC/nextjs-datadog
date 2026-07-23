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

export interface TraceIdentifiers {
  spanId: string;
  traceId: string;
}
