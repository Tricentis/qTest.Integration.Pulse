# Changelog

All notable changes to the qTest Pulse Community Marketplace are documented in
this file. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Correlation-id fallbacks no longer import Node's unsupported `crypto` module
  inside Pulse Actions. They now generate non-security UUID-shaped identifiers
  using only JavaScript APIs exposed by the QuickJS sandbox.

## [3.0.0] - 2026-08-12

### Added

- Delivery contract version 2 with native JSON, byte-preserving Base64 XML/TRX,
  automatic format detection, correlation ids, request timeouts, and explicit
  size and HTTP failure handling.
- Test Suite destinations throughout the maintained delivery, parser, and qTest
  submission path while retaining Test Cycle support.
- UFT-focused transformation and destination tests, repository-wide parser
  contract checks, and focused qTest, ChatOps, and CI tests.
- CI Actions for GitHub Actions, GitLab CI/CD, Azure Pipelines, CircleCI,
  Bitbucket Pipelines, and Buildkite.
- Operator documentation for setup, repository inventory, child-execution
  reconciliation, and v2-to-v3 migration.
- Leading usage documentation on every deployable Pulse Action.

### Changed

- The delivery script uses Node.js built-in `fetch` and requires no runtime npm
  dependency installation.
- All maintained parsers invoke only `UpdateQTestWithResults`, await the child
  invocation, and log returned Pulse execution ids.
- `UpdateQTestWithResults.js` selects the qTest Test Cycle v3 or Test Suite v3.1
  endpoint and payload from canonical destination metadata.
- qTest submission and queue processing now distinguish correlation ids, Pulse
  execution ids, and qTest processing queue ids.
- Downstream Pulse 5xx responses are treated as ambiguous outcomes and are not
  retried automatically when doing so could duplicate external work.
- Slack uses a Workflow Builder webhook; Slack and Teams share the neutral
  `ChatOpsEvent` input contract while remaining separate provider Actions.
- Jenkins standard and parameterized builds are handled by one Action.
- CI Actions use awaited requests, safe error normalization, correlation, secret
  redaction, and optional provider-neutral ChatOps reporting.
- The root README and component documentation now describe complete Pulse
  Trigger, Action, Rule, Constant, deployment, and verification procedures.

### Fixed

- `ManagerURL` now consistently accepts only the qTest Manager hostname and all
  maintained qTest requests construct HTTPS URLs internally.
- Required downstream invocations can no longer finish silently without logging
  child execution metadata or surfacing an unknown outcome.
- Result-size enforcement, command awaiting, malformed input detection, queue
  polling bounds, and error handling no longer rely on unsafe response-shape
  assumptions.
- The Jira marketplace Action syntax error identified in the baseline audit is
  corrected.

### Removed

- The deprecated Slack attachment Action and its obsolete file-upload path.
- The separate parameterized Jenkins Action; its compatibility inputs are
  accepted by `TriggerJenkins.js`.
- The unsupported embedded Scenario/Cucumber import bundle and its public
  setup references.
- Historical maintained-parser Trigger variants named
  `UpdateQTestWithFormattedResults` and
  `UpdateQTestWithFormattedResultsEvent`.

### Migration

This is a breaking release. Existing installations must update their Pulse
objects and Rule connections deliberately. Follow
[Migrating from v2 to v3](docs/MIGRATING_TO_V3.md) before enabling the new
Actions in a production project.

## [2.0.0] - 2024-05-03

### Fixed

- Converted the delivery buffer-size value from a string to a number, as
  recorded by the tagged commit.

## [1.0.0-core] - 2024-03-14

### Added

- Added the Worksoft Certify result parser, as recorded by the tagged commit.

[3.0.0]: https://github.com/Tricentis/qTest.Integration.Pulse/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/Tricentis/qTest.Integration.Pulse/releases/tag/v2.0.0
[1.0.0-core]: https://github.com/Tricentis/qTest.Integration.Pulse/releases/tag/v1.0.0-core
