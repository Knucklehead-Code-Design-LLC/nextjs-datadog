# nextjs-datadog

Community-maintained glue for complete Datadog context in Next.js: framework
route metadata, correlated server logs, OpenTelemetry spans, request IDs, and
Datadog RUM.

> [!IMPORTANT]
> This project is independent and is not affiliated with, sponsored by, or
> endorsed by Datadog, Inc. Datadog is a trademark of Datadog, Inc.

## Why

Next.js can report a server error without telling a normal `console.error`
which route, request, render phase, or active trace failed. `nextjs-datadog`
connects the supported framework and vendor hooks while keeping transport and
credentials under your control.

It provides:

- a Next.js `onRequestError` hook that adds route, router, render, method, and
  request-ID metadata to the active span and error log;
- JSON server logs with OpenTelemetry `trace_id` and `span_id` fields that
  Datadog recognizes for log/trace correlation;
- W3C Trace Context propagation from same-origin Datadog RUM requests to the
  Next.js server;
- Datadog's official Next.js RUM plugin and App/Pages Router helpers;
- server-side `fetch`, Axios, and HTTP(S) child spans with explicit,
  exact-origin W3C context propagation;
- an optional Next.js proxy that creates or forwards `x-request-id`; and
- AWS Amplify resource metadata helpers.

The package does **not** contain a Datadog API key, send server logs from the
browser, or create an undocumented direct intake. Server logs go to `stdout`
and traces go through a standard OpenTelemetry exporter.

## Requirements

- Node.js 20.9 or newer
- Next.js 15 or 16
- React 18 or 19
- a reachable OpenTelemetry Collector or Agent for traces
- a log forwarding path for the platform's `stdout`

The official Datadog Next.js RUM integration requires Next.js 15.3 or newer for
its `instrumentation-client` integration. AWS Amplify Hosting currently
documents managed SSR support through Next.js 15, so use Next.js 15 on Amplify
until AWS adds support for a newer major.

## Install

```bash
npm install nextjs-datadog \
  @datadog/browser-rum \
  @datadog/browser-rum-nextjs \
  @opentelemetry/api
```

`@vercel/otel` is installed by this package. The other packages are peers so
your application owns their versions and browser SDK instance.

## Run the observability demo

From a repository checkout:

```bash
npm install
npm run demo
```

Open [http://localhost:3000](http://localhost:3000) to run successful or
failing server-side requests with `fetch` and Axios. The demo shows a bounded,
in-memory preview of the resulting OpenTelemetry spans and Datadog-shaped JSON
logs, including shared `trace_id` and `span_id` values. It sends no preview data
to Datadog. A deterministic local upstream is the default; a public GitHub API
target is available as an optional live-network example.

## App Router setup

### 1. Initialize RUM

Create `instrumentation-client.ts` in the application root (or `src/` when the
application uses a `src` directory):

```ts
import { initNextDatadogRum, onRouterTransitionStart } from 'nextjs-datadog/client';

initNextDatadogRum({
  applicationId: process.env.NEXT_PUBLIC_DD_APPLICATION_ID!,
  clientToken: process.env.NEXT_PUBLIC_DD_CLIENT_TOKEN!,
  env: process.env.NEXT_PUBLIC_DD_ENV!,
  service: process.env.NEXT_PUBLIC_DD_SERVICE!,
  sessionReplaySampleRate: 20,
  sessionSampleRate: 100,
  site: 'datadoghq.com',
  trackLongTasks: true,
  trackResources: true,
  trackUserInteractions: true,
  version: process.env.NEXT_PUBLIC_DD_VERSION!,
});

export { onRouterTransitionStart };
```

The client token and application ID are intended for browser use. Never put a
Datadog API key in a `NEXT_PUBLIC_*` variable.

### 2. Track normalized routes

Mount Datadog's App Router component once:

```tsx
// app/layout.tsx
import { DatadogAppRouter } from 'nextjs-datadog/client';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <DatadogAppRouter />
        {children}
      </body>
    </html>
  );
}
```

### 3. Capture client error boundaries

```tsx
// app/error.tsx
'use client';

import { useEffect } from 'react';
import { addNextjsError } from 'nextjs-datadog/client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset(): void;
}) {
  useEffect(() => {
    addNextjsError(error);
  }, [error]);

  return <button onClick={reset}>Try again</button>;
}
```

For a Server Component error, Next.js exposes the same `error.digest` to the
client boundary and the server error hook. This gives you a second correlation
key when a trace was not sampled.

### 4. Capture server request errors

Create `instrumentation.ts` in the same root as `instrumentation-client.ts`:

```ts
import {
  createNextDatadogInstrumentation,
  detectAwsAmplifyResourceAttributes,
} from 'nextjs-datadog/instrumentation';

const datadog = createNextDatadogInstrumentation({
  env: process.env.DD_ENV!,
  outboundTracingOrigins: [process.env.BACKEND_ORIGIN!],
  resourceAttributes: detectAwsAmplifyResourceAttributes(),
  service: process.env.DD_SERVICE!,
  version: process.env.DD_VERSION!,
});

export const register = datadog.register;
export const onRequestError = datadog.onRequestError;
```

This uses Next.js's supported instrumentation contract rather than wrapping
route handlers individually.

### 5. Trace calls to backend services

`@vercel/otel` creates child spans for server-side `fetch` and Node.js HTTP(S)
requests. That includes Axios when it uses its Node adapter. By default it does
not send trace context to arbitrary remote hosts. Add each backend you operate
to `outboundTracingOrigins`:

```ts
const datadog = createNextDatadogInstrumentation({
  env: process.env.DD_ENV!,
  outboundTracingOrigins: ['https://api.example.com', 'http://localhost:4000'],
  service: process.env.DD_SERVICE!,
  version: process.env.DD_VERSION!,
});
```

Each value must be an exact HTTP(S) origin without credentials, a path, query,
or fragment. The package normalizes and deduplicates up to 32 origins, then
adds them to `@vercel/otel`'s public `propagateContextUrls` configuration.
Requests to other hosts still receive client spans, but they do not receive
`traceparent` or `tracestate` headers from this allowlist.

This option applies only to requests made by the Next.js server. For browser
requests sent directly to a cross-origin backend, add an object with
`propagatorTypes: ['tracecontext']` to the RUM `allowedTracingUrls` option and
allow the `traceparent` header in that backend's CORS policy.

The destination service must extract W3C Trace Context. Recent Datadog tracing
SDKs support it; verify the backend's propagation configuration if its spans
start a separate trace. Use the advanced `otel.instrumentationConfig.fetch`
option when you need path-specific propagation, exclusions, ignored URLs, or
custom fetch attributes. Those rules are composed with
`outboundTracingOrigins`.

Before export, the package's privacy span processor removes URL credentials,
query strings, and fragments from standard URL attributes and URL-shaped span
names. It also bounds their length. URL paths remain because they identify
outbound resources, so keep sensitive values out of paths. The processor is
prepended to any processors supplied through `otel.spanProcessors`.

### 6. Propagate a request ID

On Next.js 16, add `proxy.ts`:

```ts
import { createDatadogProxy } from 'nextjs-datadog/proxy';

export const proxy = createDatadogProxy();

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

On Next.js 15, export the same function as `middleware` from `middleware.ts`:

```ts
import { createDatadogProxy } from 'nextjs-datadog/proxy';

export const middleware = createDatadogProxy();
```

An existing valid request ID is preserved. Otherwise the proxy generates a
UUID, forwards it as a request header, and returns it as a response header. Set
`exposeRequestId: false` to keep it out of the response.

If the application already owns proxy logic, compose the narrower request
context helper into the existing `NextResponse.next` call:

```ts
import { createDatadogRequestContext } from 'nextjs-datadog/proxy';
import { type NextRequest, NextResponse } from 'next/server';

export const proxy = (request: NextRequest) => {
  const datadog = createDatadogRequestContext(request);
  datadog.headers.set('x-pathname', request.nextUrl.pathname);

  const response = NextResponse.next({
    request: {
      headers: datadog.headers,
    },
  });

  response.headers.set(datadog.requestIdHeader, datadog.requestId);
  return response;
};
```

This preserves the application's redirects, authentication, CSP, and other
proxy behavior while adding only the request context.

## Pages Router

Initialize RUM in `instrumentation-client.ts` without exporting
`onRouterTransitionStart`, then mount `DatadogPagesRouter` in `pages/_app.tsx`.
`ErrorBoundary` is also re-exported from `nextjs-datadog/client`.

## AWS Amplify delivery

Amplify sends SSR runtime output to CloudWatch Logs. The default server logger
therefore emits one JSON object per line to `stdout`. Subscribe the Amplify
compute log group to your Datadog log forwarding setup; the package does not
ship a server credential or bypass CloudWatch.

For traces, configure the standard OpenTelemetry exporter variables in the
Amplify runtime:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-collector.example.com
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

The endpoint should be an OpenTelemetry Collector or Datadog Agent endpoint
that is reachable from Amplify and configured to export to Datadog. Keep the
Datadog API key at the collector/forwarder, not in the Next.js client bundle.

Use the same three unified service tags on the browser and server:

```text
DD_SERVICE=checkout-web
DD_ENV=production
DD_VERSION=<deployed commit SHA>

NEXT_PUBLIC_DD_SERVICE=checkout-web
NEXT_PUBLIC_DD_ENV=production
NEXT_PUBLIC_DD_VERSION=<same deployed commit SHA>
```

## Metadata and privacy

The server error hook records:

| Field                         | Source                                    |
| ----------------------------- | ----------------------------------------- |
| `http.request.method`         | Next.js request metadata                  |
| `http.route`                  | Parameterized Next.js route               |
| `url.path`                    | Optional path with query/fragment removed |
| `nextjs.router_kind`          | App Router or Pages Router                |
| `nextjs.route_type`           | Render, route, action, or proxy           |
| `nextjs.render_source`        | Next.js render source, if set             |
| `nextjs.revalidate_reason`    | Revalidation reason, if set               |
| `request.id`                  | Configured request-ID header              |
| `trace_id` / `span_id`        | Active OpenTelemetry context              |
| `error.digest`                | Next.js error digest, if set              |
| `service` / `env` / `version` | Unified service tags                      |

Concrete URL paths are disabled by default because dynamic segments may contain
personal data. Set `includeUrlPath: true` only when your route design makes
paths safe; queries and fragments are still removed. Cookies, authorization
headers, bodies, and arbitrary request headers are not collected. Attribute
keys, counts, and string sizes are bounded. Outbound span URL credentials,
queries, and fragments are removed before export; outbound paths remain. Add
only low-cardinality, non-sensitive application context:

```ts
const datadog = createNextDatadogInstrumentation({
  env: process.env.DD_ENV!,
  getRequestAttributes: ({ request }) => ({
    // Prefer opaque tenant IDs and feature names. Do not add emails or tokens.
    'tenant.id': readSyntheticTenantId(request.headers),
  }),
  service: process.env.DD_SERVICE!,
  version: process.env.DD_VERSION!,
});
```

Framework-owned metadata cannot be replaced by custom attributes.

## Structured application logs

Use the server-only entrypoint for logs outside `onRequestError`:

```ts
import { createDatadogLogger } from 'nextjs-datadog/server';

export const logger = createDatadogLogger({
  env: process.env.DD_ENV!,
  service: process.env.DD_SERVICE!,
  version: process.env.DD_VERSION!,
});

logger.info('Order submitted', {
  attributes: {
    'order.id': order.id,
    'request.id': request.headers.get('x-request-id'),
  },
});
```

When called in an active span, the log contains 32-character hexadecimal
`trace_id` and 16-character hexadecimal `span_id` fields for Datadog
correlation. Telemetry serialization and writer failures are contained so they
cannot fail the application request. Use `transformError` to apply additional
redaction.

## What the complete trace shows

With RUM, instrumentation, an outbound origin allowlist, and delivery
configured, a browser request produces this hierarchy in Datadog:

```text
RUM view/action
  └─ RUM resource → traceparent
       └─ Next.js request trace
            ├─ framework render and route spans
            ├─ correlated server logs
            └─ fetch or Axios client span → traceparent
                 └─ backend service trace
                      └─ database and downstream spans
```

Datadog derives request rate, error rate, and latency views from the ingested
server spans. This package does not create a separate metrics protocol for
those APM views. Application-specific metrics remain the responsibility of the
application's metrics SDK or OpenTelemetry metric reader.

## Runtime boundaries

Import from the narrowest entrypoint:

- `nextjs-datadog/client` — browser RUM only
- `nextjs-datadog/instrumentation` — Next.js instrumentation and OTel setup
- `nextjs-datadog/proxy` — request-ID propagation
- `nextjs-datadog/server` — correlated JSON logging
- `nextjs-datadog` — shared types and unified tag validation

The package is ESM-only and side-effect free. CI rejects server dependencies in
the generated client entrypoint.

## Documentation

- [Architecture and data flow](docs/architecture.md)
- [Release process](docs/releasing.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support policy](SUPPORT.md)

## License

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for
project attribution and trademark information.
