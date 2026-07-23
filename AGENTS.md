# Engineering Working Agreements

- Treat every change as production-quality and preserve unrelated work.
- Search existing owners and public exports before adding an abstraction.
- Keep browser, shared, Node.js, deployment-adapter, and testing responsibilities
  behind explicit package entry points.
- Prefer Next.js, OpenTelemetry, W3C, and Datadog public contracts over custom
  protocols or private implementation details.
- Never expose server credentials, cookies, authorization, request bodies, or
  sensitive telemetry through client bundles or default logging.
- Make metadata collection allowlisted, bounded, documented, and covered by
  redaction tests.
- Preserve consumer behavior through composition; do not assume ownership of an
  application's proxy, logger, instrumentation, error boundary, or exporter.
- Add tests for observable behavior, including relevant failures, boundaries,
  runtime differences, concurrency, and regressions.
- Run applicable formatting, lint, type-check, test, build, package, and example
  verification commands.
- Before finishing, review the complete diff for correctness, duplication,
  placement, readability, security, privacy, compatibility, test effectiveness,
  and unintended scope.
- Report exact checks and intentional omissions.
