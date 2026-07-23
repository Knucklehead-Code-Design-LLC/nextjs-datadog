# Architecture and data flow

`nextjs-datadog` is an integration layer. It connects supported Next.js,
Datadog, and OpenTelemetry contracts without owning telemetry storage or vendor
credentials.

## Correlation model

```text
Browser navigation
  └─ Datadog RUM view/error/resource
       └─ same-origin fetch with W3C traceparent + tracestate
            └─ Next.js server span
                 ├─ onRequestError route/render/request metadata
                 ├─ structured stdout log with trace_id + span_id
                 └─ OTLP exporter → Collector/Agent → Datadog APM

Amplify stdout → CloudWatch Logs → Datadog forwarding → Datadog Logs
```

Correlations use multiple durable keys:

- W3C trace context links a RUM resource to a backend trace.
- OpenTelemetry `trace_id` and `span_id` link server logs to the active trace.
- unified `service`, `env`, and `version` values align browser and server data.
- `error.digest` links a redacted Server Component error in RUM to its full
  server-side error.
- `request.id` follows the request even when a trace is not sampled.

## Entrypoint ownership

The package has explicit entrypoints to keep runtime boundaries inspectable.

| Entrypoint         | Runtime       | Responsibility                                                       |
| ------------------ | ------------- | -------------------------------------------------------------------- |
| `/client`          | Browser       | RUM initialization, route tracking, client errors, trace propagation |
| `/instrumentation` | Node/Next.js  | OTel registration and Next.js request-error reporting                |
| `/proxy`           | Next.js proxy | Request-ID creation and forwarding                                   |
| `/server`          | Node/Next.js  | Structured logs and active trace correlation                         |
| package root       | Shared        | Types and unified service tag validation                             |

The browser entrypoint is built separately and checked for server imports and a
compressed size ceiling.

## Transport ownership

The package deliberately does not call a Datadog server intake:

- RUM is delivered by Datadog's official browser SDK using its public client
  token.
- traces use `@vercel/otel` and a standard OTLP exporter configuration.
- logs use structured `stdout`, which hosting platforms already capture.
- a Collector, Agent, CloudWatch subscription, or other deployment integration
  owns authenticated delivery to Datadog.

This avoids embedding server credentials, implements standard backpressure and
retry boundaries outside short-lived Next.js requests, and keeps the package
portable across managed hosting providers.

## Failure model

Invalid required configuration fails during setup. Once configured, telemetry
writers and optional enrichment callbacks do not throw into the application
error path. A failed optional stage emits a bounded diagnostic through the
configured logger when possible.

The integration does not claim delivery success. Export and forwarding health
must be monitored at the Collector, Datadog Agent, CloudWatch subscription, and
Datadog intake layers.

## Privacy defaults

Only documented framework metadata is collected. Concrete URL paths are
disabled by default; when explicitly enabled, query strings and fragments are
removed. No cookies, authorization values, bodies, or arbitrary headers are
collected.

Custom attributes accept only primitive values, use validated keys, and are
bounded by count and string length. Core route and request fields take
precedence over custom attributes.
