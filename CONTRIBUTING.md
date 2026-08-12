# Contributing

Thank you for improving the qTest Pulse Community Marketplace. Changes should
remain understandable to administrators who configure Pulse through the UI and
to developers who maintain standalone Actions.

## Before You Start

1. Search existing issues and pull requests for related work.
2. Open an issue for a new integration, contract change, dependency, or
   behavior that could affect existing Pulse projects.
3. Describe the intended Trigger, input payload, required Constants, emitted
   events, provider/API version, and compatibility impact.
4. Do not include customer payloads, credentials, signed webhook URLs, tenant
   hostnames, proprietary source, or organization-specific field ids.

## Development Environment

Use an Active LTS or Maintenance LTS Node.js release. At the time of this
documentation audit, Node.js 22 and 24 are supported LTS lines. Check the
[Node.js release table](https://nodejs.org/en/about/previous-releases) before
starting new work.

Install the repository-only development dependencies and run validation:

```shell
npm ci
npm run validate
```

The package manifest supports local testing. A deployable Pulse Action must
remain one standalone JavaScript file and must not install packages while it is
executing. Use only APIs and packages confirmed to exist in the target Pulse
runtime, or bundle approved shared development code into the standalone file.

## Rule Requirements

Every JavaScript rule under `chatops`, `citools`, `parsers`, or `qtest` must
begin with a documentation comment that states:

- what the Action does and how it is wired in Pulse;
- its expected input event;
- required and optional Constants;
- required and optional downstream Triggers;
- its output or external side effect; and
- important limitations, compatibility behavior, or prerequisites.

Keep examples short. Link to the relevant directory README and an authoritative
provider document when a complete external payload or permission model is
needed.

New and modernized rules should also:

- validate configuration and payloads before external requests;
- use four spaces, camelCase variables/functions, and the repository's existing
  formatting conventions;
- use async/await and await required work so Pulse status represents actual
  completion;
- log correlation id, stage, provider/rule, duration, and safe identifiers;
- normalize timeout, transport, HTTP, and validation errors without assuming
  `error.response` exists;
- redact authorization values, API tokens, signed URLs, and secret-like fields;
- avoid retrying a non-idempotent request after an ambiguous response; and
- add fixtures and focused tests for contract or transformation changes.

## Documentation Requirements

Update the main README or the owning directory README when you change:

- setup steps or required Pulse objects;
- Constant or Trigger names;
- payload shape or schema version;
- provider permissions or API versions;
- compatibility and deprecation behavior; or
- operational troubleshooting and recovery.

Use relative links for repository files. Use stable, authoritative vendor links
for external product and API documentation. Run `npm run validate` to check
local links and rule headers before submitting the change.

## Pull Requests

1. Keep the change focused and document any migration required by existing
   users.
2. Explain how the Action was tested, including whether a live provider smoke
   test was performed.
3. Include sanitized sample payloads or fixtures when they materially clarify
   the contract.
4. Confirm that no credentials or customer data appear in source, fixtures,
   logs, screenshots, or commit history.
5. Reference the related issue and complete the pull-request checklist.

Expect review feedback on Pulse runtime compatibility, backward compatibility,
security, error handling, and end-user documentation.
