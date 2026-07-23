import type { DatadogLogRecord } from 'nextjs-datadog/server';

const MAX_PREVIEW_RECORDS = 80;

export type PreviewAttributeValue = boolean | number | string;

export interface PreviewSpan {
  attributes: Readonly<Record<string, PreviewAttributeValue>>;
  durationMs: number;
  kind: string;
  name: string;
  parentSpanId?: string;
  spanId: string;
  status: string;
  timestamp: string;
  traceId: string;
}

export interface TelemetrySnapshot {
  logs: readonly DatadogLogRecord[];
  spans: readonly PreviewSpan[];
}

interface TelemetryStore {
  logs: DatadogLogRecord[];
  spans: PreviewSpan[];
}

declare global {
  var __nextjsDatadogDemoStore__: TelemetryStore | undefined;
}

const getStore = (): TelemetryStore => {
  globalThis.__nextjsDatadogDemoStore__ ??= {
    logs: [],
    spans: [],
  };

  return globalThis.__nextjsDatadogDemoStore__;
};

const appendBounded = <Value>(records: Value[], value: Value): void => {
  records.push(value);

  if (records.length > MAX_PREVIEW_RECORDS) {
    records.splice(0, records.length - MAX_PREVIEW_RECORDS);
  }
};

export const addPreviewLog = (record: Readonly<DatadogLogRecord>): void => {
  appendBounded(getStore().logs, { ...record });
};

export const addPreviewSpan = (span: PreviewSpan): void => {
  appendBounded(getStore().spans, span);
};

export const clearTelemetry = (): void => {
  const store = getStore();
  store.logs.splice(0);
  store.spans.splice(0);
};

export const getTelemetrySnapshot = (): TelemetrySnapshot => {
  const store = getStore();

  return {
    logs: [...store.logs].reverse(),
    spans: [...store.spans].reverse(),
  };
};
