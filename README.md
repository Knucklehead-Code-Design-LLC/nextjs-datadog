# nextjs-datadog

Community-maintained observability integration for Next.js applications using
Datadog.

> [!IMPORTANT]
> This project is independent and is not affiliated with, sponsored by, or
> endorsed by Datadog, Inc. Datadog is a trademark of Datadog, Inc.

## Status

This project is in its initial design phase. It does not have a supported npm
release yet. Public APIs, runtime support, and deployment adapters will be
defined before the first prerelease.

The intended scope includes:

- server-side Next.js error reporting with request and route context;
- correlation between Datadog RUM, traces, and structured server logs;
- OpenTelemetry-based tracing for managed hosting environments;
- safe metadata enrichment and redaction;
- deployment guidance for AWS Amplify Hosting; and
- test helpers that prove propagation and telemetry behavior.

The project will build on official Next.js, OpenTelemetry, and Datadog APIs. It
will not reimplement Datadog's browser SDK or claim to be an official Datadog
integration.

## Contributing

The project welcomes focused issues and pull requests. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before proposing or implementing a change.
Larger public API, runtime, transport, dependency, or security decisions should
start with an issue so maintainers and contributors can agree on the contract
before implementation.

- [Contribution guide](CONTRIBUTING.md)
- [Project governance](GOVERNANCE.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [Support policy](SUPPORT.md)

## License

The open-source license is being selected before implementation begins. Until a
license file is added, no permission is granted to copy, modify, or distribute
the repository contents.
