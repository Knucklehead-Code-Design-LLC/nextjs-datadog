# Project Governance

## Scope

`nextjs-datadog` is maintained by Knucklehead Code Design LLC as an independent
open-source project. It integrates public Next.js, OpenTelemetry, and Datadog
interfaces without representing itself as an official project of those vendors.

## Roles

Maintainers set project direction, review and merge contributions, manage
releases, respond to security reports, and enforce project policies.
Contributors participate through issues, discussions, reviews, documentation,
and code changes.

Consistent, constructive participation may lead to expanded triage or
maintenance access. Access is granted by the existing maintainers based on the
project's needs, demonstrated judgment, and sustained participation; it is not
automatic based on contribution count.

## Decision Making

Routine implementation decisions are made through pull request review. Changes
to public APIs, compatibility, dependencies, telemetry transport, privacy
defaults, licensing, governance, or release policy require an issue with a
written proposal before implementation.

Maintainers seek consensus after considering user impact, standards alignment,
operational risk, maintainability, and project scope. When consensus is not
possible, the maintainers make and document the decision. Urgent security or
release-safety changes may be made first and documented as soon as disclosure
constraints allow.

## Releases

Only maintainers may publish releases. Releases must originate from reviewed
repository content and the configured GitHub Actions trusted-publishing
workflow. Local npm publication is not part of the normal release process.

The detailed versioning, deprecation, provenance, and release-approval policy
will be established before the first npm prerelease.

## Policy Changes

Governance and contribution-policy changes use the same pull request process as
code changes. Material changes should explain their effect on contributors and
maintainers.
