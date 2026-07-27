# Datadog investigation queries

Use a fixed time window and replace `<service>`, `<env>`, and `<version>` with
your own low-cardinality values. These queries do not require a dashboard or a
package-specific Datadog pipeline.

## Confirm the deployed integration

In Trace Explorer, start with:

```text
service:<service> env:<env> @telemetry.distro.name:nextjs-datadog
```

Group by `@telemetry.distro.version` to find the installed package versions.
Group by the reserved `version` tag separately to find application deploys.
Mixed package or application versions in a narrow rollout window usually mean
multiple warm instances are still serving traffic.

Structured logs carry the same integration fields:

```text
service:<service> @telemetry.distro.name:nextjs-datadog
```

## Check lifecycle and failure coverage

Find incoming server spans and failed outbound calls:

```text
service:<service> env:<env> @span.kind:server
service:<service> env:<env> @span.kind:client status:error
```

In Trace Explorer, group server spans by `resource_name` and `@http.route`.
Stable request resources should use parameterized routes rather than concrete
identifiers. Group all spans by `resource_name` to see whether framework phases
or downstream resources dominate indexed volume.

Find package request-error logs:

```text
service:<service> "Next.js request failed"
```

Then add one field at a time to measure coverage:

```text
@http.route:*
@nextjs.router_kind:*
@nextjs.route_type:*
@nextjs.render_source:*
@nextjs.revalidate_reason:*
@request.id:*
@error.kind:*
@error.digest:*
trace_id:*
span_id:*
```

Group by `@nextjs.route_type`, `@nextjs.render_source`, `@error.kind`, and
`@http.route` to distinguish rendering, route-handler, Server Action, proxy,
and revalidation failures that are present in the deployment. A zero count for
a lifecycle type is evidence only that no matching failure log was ingested in
the selected window; normal successful execution does not call
`onRequestError`.

Retries, timeouts, and cancellations are owned by the framework or downstream
client instrumentation. Inspect failed client spans and their error attributes
inside the trace rather than inferring them from the request-error log. Use a
platform-provided cold-start attribute when one exists; this package does not
invent a cross-platform cold/warm signal.

## Check correlation and sampling

Start from a request-error log with both reserved fields:

```text
service:<service> "Next.js request failed" trace_id:* span_id:*
```

Open its Trace tab, then inspect the request span, render or route phase, and
downstream children. Confirm that duration bars do not overlap impossibly,
parent/child relationships are intact, and the span carrying the exception is
marked as an error.

A Trace tab with zero retained spans does not prove context propagation failed.
Log forwarding and trace intake have independent sampling, retention, indexing,
and delivery paths. Distinguish the cases as follows:

- missing `trace_id` or `span_id` on the log: no valid active span was available
  when the log was written;
- identifiers present but no retained trace: inspect trace sampling, retention,
  indexed-span filters, and exporter health;
- a retained trace with orphan spans: inspect W3C extraction and propagation,
  runtime context management, and downstream instrumentation;
- a separate downstream trace: verify the destination extracts W3C Trace
  Context and that its origin is explicitly allowlisted.

## Check duplication, volume, and cardinality

Group request-error logs by `trace_id`. Multiple logs in one trace can represent
separate framework failures, so compare their `span_id`, `@http.route`,
`@nextjs.route_type`, `@error.kind`, and `@error.digest` before classifying them
as duplicates.

In Trace Explorer, group by `resource_name` and compare:

```text
service:<service> @span.kind:server
service:<service> @span.kind:client
```

Outbound paths use `/<redacted>` by default, while origin, method, status,
duration, and error state remain queryable. If concrete outbound resources
appear after enabling `includeOutboundUrlPath`, review the group count and
sample values for entity IDs, tenant names, personal data, tokens, or other
unbounded segments. Disable the option when any path is not demonstrably safe.
