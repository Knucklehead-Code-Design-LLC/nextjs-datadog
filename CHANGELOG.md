# nextjs-datadog

## 0.2.0

### Minor Changes

- 52bc031: Add secure direct Datadog OTLP delivery for constrained managed Next.js
  runtimes, document explicit Amplify resource metadata, and sanitize framework
  URL attributes added after span start.

## 0.1.0

### Minor Changes

- 8cbda8b: Harden Next.js server observability with exact-origin W3C propagation for
  fetch, Axios, and Node.js HTTP calls, privacy-safe outbound span URLs, bounded
  error metadata, safer Amplify detection, idempotent registration, readability
  linting, expanded regression coverage, and a runnable local telemetry demo.
- 6b21c3c: Add the first public integration for correlated Next.js request errors, server
  logs, OpenTelemetry spans, request IDs, and Datadog RUM.
