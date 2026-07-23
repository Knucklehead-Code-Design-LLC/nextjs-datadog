# Observability demo

This local Next.js application shows the structured logs and OpenTelemetry spans
created while a server route calls an upstream API with `fetch` or Axios.

```sh
npm run demo
```

Open [http://localhost:3000](http://localhost:3000), choose a request, and use
the spans, logs, and raw JSON views to inspect correlation IDs and safe
attributes.

The default local API is deterministic. The optional GitHub target uses its
unauthenticated public REST API, which is limited to 60 requests per hour. The
preview keeps at most 80 logs and 80 spans in server memory and does not collect
request bodies, cookies, authorization headers, or raw query strings.

To forward telemetry as well as preview it, configure the standard OpenTelemetry
exporter environment variables. To enable Datadog RUM, copy `.env.example` to
`.env.local` and provide the two public browser credentials.
