# Contributing to nextjs-datadog

Thank you for helping make Next.js observability easier to adopt and safer to
operate. Contributions should improve a clear user-facing or maintainer-facing
contract while keeping setup small, behavior explicit, and telemetry secure.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in this project is provided under the
[Apache License 2.0](LICENSE), without additional terms or conditions. By
submitting a contribution, you represent that you have the right to license it
to the project on those terms.

## Before You Start

Use the repository's issue templates to report a reproducible defect or propose
a focused enhancement. A pull request may be opened directly for a small,
well-scoped correction such as documentation, tests, or an obvious bug fix.

Open a design issue before implementing a change that affects any of the
following:

- public APIs or package entry points;
- supported Next.js, Node.js, React, Datadog, or OpenTelemetry versions;
- runtime behavior in Node.js, Edge, serverless, or managed hosting;
- telemetry transport, authentication, sampling, or flushing;
- default metadata, redaction, or privacy behavior;
- production dependencies or package size;
- release, compatibility, or deprecation policy; or
- more than one deployment platform.

This avoids asking contributors to complete substantial work before maintainers
agree that the proposed contract belongs in the project.

For security vulnerabilities, do not open a public issue. Follow
[SECURITY.md](SECURITY.md).

## Development Principles

- Make the smallest coherent change that fully handles the requested behavior.
- Search for an existing owner before adding a utility, wrapper, fixture, or
  abstraction.
- Keep browser, shared, Node.js, and test code behind explicit package entry
  points. Server-only dependencies and secrets must never enter client bundles.
- Prefer platform and vendor standards, including Next.js instrumentation hooks,
  W3C Trace Context, OpenTelemetry semantic conventions, and Datadog unified
  service tagging.
- Treat privacy and security as API contracts. New metadata must be allowlisted,
  bounded, documented, and tested for sensitive-data leakage.
- Preserve an application's existing proxy, logger, instrumentation, and error
  handling through composition.
- Fail clearly for invalid configuration. Do not silently report successful
  instrumentation when telemetry cannot be delivered.
- Avoid unnecessary production dependencies and import-time side effects.

## Testing Expectations

Tests must prove observable behavior rather than mirror implementation details.
Choose cases based on the contract and risk, including applicable boundaries,
failure paths, runtime differences, redaction, sampling, retries, and
concurrency.

High-risk changes should prove relevant behavior such as:

- incoming trace context is continued correctly;
- active trace and span identifiers are attached to logs;
- route and request metadata are normalized and bounded;
- secrets, cookies, authorization, and configured sensitive values are removed;
- client bundles do not contain server modules or credentials;
- existing Next.js proxy and instrumentation behavior is preserved;
- telemetry failures do not break application requests; and
- short-lived runtimes flush or abandon telemetry according to the documented
  policy.

A regression fix should include a test that fails without the fix whenever the
behavior can be tested reliably.

Install the locked dependency graph and run the complete local gate:

```bash
npm ci
npm run verify
```

`verify` checks formatting, ESLint, TypeScript, behavioral tests with coverage,
the production dependency audit, the ESM build, published type resolution, the
tarball manifest, every public entrypoint, and the browser/server dependency
boundary.

Useful focused commands are:

```bash
npm test
npm run test:coverage
npm run lint
npm run typecheck
npm run check:package
```

Every user-visible fix or feature must also include a Changeset:

```bash
npm run changeset
```

## Pull Request Workflow

1. Fork the repository or create a branch in the organization if you have write
   access.
2. Branch from the current `main` branch.
3. Keep commits focused and write outcome-oriented commit messages.
4. Update tests and documentation with the implementation.
5. Run all applicable formatting, lint, type-check, test, build, and package
   validation commands.
6. Review the complete diff for correctness, duplication, privacy, public API
   compatibility, test effectiveness, and unintended scope.
7. Open a pull request using the repository template.

Draft pull requests are welcome when they contain enough context for useful
early feedback. Mark the pull request ready only when its intended scope is
implemented, documented, and locally verified.

## Pull Request Requirements

A reviewable pull request must:

- explain the outcome and why the change belongs in this package;
- identify public API, runtime, dependency, privacy, and compatibility effects;
- link the relevant issue when prior design agreement is required;
- contain tests for new or changed observable behavior;
- update user-facing documentation in the same change;
- list exact verification commands and results;
- disclose checks that were skipped and why;
- avoid unrelated formatting or refactoring; and
- remain reasonably sized or explain why it cannot be split safely.

Do not check a verification box for a command that was not run. Reviewers value
accurate evidence more than a fully checked template.

## Review And Merge

Maintainers review for behavioral correctness, security and privacy, public API
design, compatibility, dependency cost, documentation, and test effectiveness.
Review feedback should explain the affected contract and desired outcome.

All required conversations and automated checks must be resolved before merge.
The project prefers squash merges so the pull request title becomes the durable
history entry. Maintainers may edit the title for clarity before merging.

Approval does not guarantee immediate release. Releases follow the project's
versioning and compatibility policy in [docs/releasing.md](docs/releasing.md).
