# Security Policy

## Reporting A Vulnerability

Do not disclose suspected vulnerabilities in a public issue, discussion, or
pull request.

Use GitHub's private vulnerability reporting for this repository. If that is
unavailable, email
[dev@knuckleheadcodedesign.com](mailto:dev@knuckleheadcodedesign.com) with the
subject `nextjs-datadog security report`.

Include, when possible:

- the affected version, commit, or configuration;
- deployment and runtime details;
- reproduction steps or a minimal reproducer;
- the security or privacy impact;
- any known mitigations; and
- whether the report is subject to a disclosure deadline.

Do not include real customer secrets, personal information, session data, or
protected telemetry in a report. Use synthetic values.

The maintainers will acknowledge a complete report as soon as practical,
coordinate investigation and remediation privately, and discuss disclosure
timing with the reporter. Response and remediation time depend on severity,
reproducibility, maintainer availability, and upstream dependencies.

## Supported Versions

The project has not published a supported release. This section will be updated
before the first npm prerelease. Security fixes will target supported release
lines and may require upgrading Next.js, Node.js, OpenTelemetry, or Datadog
dependencies.

## Security Design Expectations

Changes must keep server credentials out of browser bundles, treat incoming
trace and request identifiers as untrusted input, bound high-cardinality
metadata, redact sensitive data by default, and avoid making application
availability depend on telemetry delivery.
