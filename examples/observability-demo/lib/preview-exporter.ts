import { ExportResultCode } from '@opentelemetry/core';
import {
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';

import { addPreviewSpan, type PreviewAttributeValue, type PreviewSpan } from './telemetry-store';

const PREVIEW_ATTRIBUTE_KEYS = new Set([
  'demo.preview',
  'demo.scenario',
  'demo.target',
  'demo.transport',
  'http.method',
  'http.request.method',
  'http.response.status_code',
  'http.route',
  'http.status_code',
  'next.span_name',
  'next.span_type',
  'server.address',
  'server.port',
  'url.scheme',
]);

const SPAN_KINDS = ['internal', 'server', 'client', 'producer', 'consumer'];
const SPAN_STATUSES = ['unset', 'ok', 'error'];
const MAX_PENDING_TRACES = 24;
const MAX_PENDING_SPANS_PER_TRACE = 32;
const MAX_PREVIEW_TRACE_IDS = 80;

const getMappedValue = (values: readonly string[], index: number, fallback: string): string => {
  const value = values[index];
  if (value) {
    return value;
  }

  return fallback;
};

const normalizeAttribute = (value: unknown): PreviewAttributeValue | undefined => {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }

  return undefined;
};

const getPreviewAttributes = (
  span: ReadableSpan,
): Readonly<Record<string, PreviewAttributeValue>> => {
  const attributes: Record<string, PreviewAttributeValue> = {};

  for (const [key, value] of Object.entries(span.attributes)) {
    if (!PREVIEW_ATTRIBUTE_KEYS.has(key)) {
      continue;
    }

    const normalizedValue = normalizeAttribute(value);
    if (normalizedValue !== undefined) {
      attributes[key] = normalizedValue;
    }
  }

  return attributes;
};

const getTimestamp = (span: ReadableSpan): string => {
  const milliseconds = span.startTime[0] * 1_000 + span.startTime[1] / 1_000_000;
  return new Date(milliseconds).toISOString();
};

const getDurationMilliseconds = (span: ReadableSpan): number => {
  return Math.round((span.duration[0] * 1_000 + span.duration[1] / 1_000_000) * 100) / 100;
};

const createPreviewSpan = (span: ReadableSpan): PreviewSpan => {
  const spanContext = span.spanContext();
  const previewSpan: PreviewSpan = {
    attributes: getPreviewAttributes(span),
    durationMs: getDurationMilliseconds(span),
    kind: getMappedValue(SPAN_KINDS, span.kind, 'unknown'),
    name: span.name,
    spanId: spanContext.spanId,
    status: getMappedValue(SPAN_STATUSES, span.status.code, 'unknown'),
    timestamp: getTimestamp(span),
    traceId: spanContext.traceId,
  };

  if (span.parentSpanContext) {
    previewSpan.parentSpanId = span.parentSpanContext.spanId;
  }

  return previewSpan;
};

class PreviewSpanExporter implements SpanExporter {
  private readonly pendingSpans = new Map<string, PreviewSpan[]>();

  private readonly previewTraceIds = new Set<string>();

  private addPendingSpan(span: PreviewSpan): void {
    const pendingSpans = this.pendingSpans.get(span.traceId) ?? [];
    pendingSpans.push(span);
    this.pendingSpans.set(span.traceId, pendingSpans.slice(-MAX_PENDING_SPANS_PER_TRACE));

    if (this.pendingSpans.size > MAX_PENDING_TRACES) {
      const oldestTraceId = this.pendingSpans.keys().next().value;
      if (typeof oldestTraceId === 'string') {
        this.pendingSpans.delete(oldestTraceId);
      }
    }
  }

  private addPreviewTrace(span: PreviewSpan): void {
    this.previewTraceIds.add(span.traceId);
    if (this.previewTraceIds.size > MAX_PREVIEW_TRACE_IDS) {
      const oldestTraceId = this.previewTraceIds.values().next().value;
      if (typeof oldestTraceId === 'string') {
        this.previewTraceIds.delete(oldestTraceId);
      }
    }

    for (const pendingSpan of this.pendingSpans.get(span.traceId) ?? []) {
      addPreviewSpan(pendingSpan);
    }

    this.pendingSpans.delete(span.traceId);
    addPreviewSpan(span);
  }

  private handleSpan(span: ReadableSpan): void {
    const previewSpan = createPreviewSpan(span);
    if (span.attributes['demo.preview'] === true) {
      this.addPreviewTrace(previewSpan);
      return;
    }

    if (this.previewTraceIds.has(previewSpan.traceId)) {
      addPreviewSpan(previewSpan);
      return;
    }

    this.addPendingSpan(previewSpan);
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: ExportResultCode }) => void,
  ): void {
    for (const span of spans) {
      this.handleSpan(span);
    }

    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export const createPreviewSpanProcessor = (): SimpleSpanProcessor => {
  return new SimpleSpanProcessor(new PreviewSpanExporter());
};
