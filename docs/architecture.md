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
                 ├─ fetch/Axios client span
                 │    └─ allowlisted W3C propagation → backend service span
                 └─ OTLP exporter → Collector/Agent or direct intake → Datadog APM

Amplify stdout → CloudWatch Logs → Datadog forwarding → Datadog Logs
```

Correlations use multiple durable keys:

- W3C trace context links a RUM resource to a backend trace.
- exact-origin outbound propagation links the Next.js request to services that
  explicitly accept W3C Trace Context.
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

The portable defaults keep authenticated transport outside the package:

- RUM is delivered by Datadog's official browser SDK using its public client
  token.
- traces use `@vercel/otel` and a standard OTLP exporter configuration.
- logs use structured `stdout`, which hosting platforms already capture.
- a Collector, Agent, CloudWatch subscription, or another deployment
  integration normally owns authenticated delivery to Datadog.

Short-lived managed SSR runtimes may be unable to run or reach a Collector or
Agent. The instrumentation entrypoint therefore offers an explicit
`directOtlp` mode. It accepts a server-only Datadog API key and a validated
Datadog site, replaces the timer-based automatic processor with an immediate
processor, and sends spans to Datadog's OTLP/HTTP intake with trace-stat
computation enabled. The credential remains confined to the server
instrumentation entrypoint.

Direct delivery trades away the Collector's stronger retry, buffering, and
backpressure boundary. It is opt-in and intended only for constrained managed
runtimes such as AWS Amplify SSR compute.

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

A privacy processor runs before configured exporters and sanitizes both span
start and completion so attributes added late by framework instrumentation are
covered. It removes URL credentials, query strings, and fragments from standard
URL attributes and URL-shaped span names, then bounds their length. A server
request with `http.route` uses that parameterized route for its target and span
name. Outbound paths remain observable so operators can identify a remote
resource; applications must not place secrets or personal data in paths.

The package also removes `@vercel/otel`'s `vercel.runtime` compatibility
attribute when the application is not running on Vercel. Platform-specific
resource attributes supplied by the application remain the authoritative host
metadata.

## Outbound request model

`@vercel/otel` owns automatic server-side fetch and Node.js HTTP(S)
instrumentation. `nextjs-datadog` does not wrap or replace application fetch
clients. The integration converts `outboundTracingOrigins` into
`@vercel/otel`'s public `propagateContextUrls` configuration and composes it
with any advanced fetch instrumentation supplied by the application.

The `@vercel/otel` fetch instrumentation also patches Node.js HTTP(S), so Axios
using its Node adapter produces client spans without an Axios interceptor.
Applications keep ownership of their Axios instances, retries, authentication,
and error handling.

Outbound requests can be traced without propagating their parent. Trace headers
are added only for configured HTTP(S) origins because third-party services do
not need application trace context. Exact-origin validation prevents a trusted
host such as `api.example.com` from accidentally matching
`api.example.com.attacker.invalid`.
