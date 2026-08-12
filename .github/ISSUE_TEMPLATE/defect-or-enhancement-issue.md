---
name: Defect or enhancement
about: Report a reproducible rule problem or propose a compatible improvement.
title: ""
labels: ""
assignees: ""
---

<!--
Never include API tokens, authorization headers, signed webhook URLs, customer
result documents, tenant details, or other confidential data. Redact payloads
and logs before posting them publicly.
-->

## Area and rule

<!-- Example: parsers/UFTXML.js at commit <sha>. -->

## Expected behavior

<!-- What should happen? For an enhancement, describe the intended contract. -->

## Actual behavior

<!-- What happened instead? Include the safe error code and HTTP status. -->

## Steps to reproduce

1.
2.
3.

## Sanitized contract details

<!--
Describe payload field names and types. Include a minimal sanitized example only
when needed. State the Trigger names, Constant names (never values), destination
type, result format/encoding, provider, and relevant API version.
-->

## Execution evidence

<!--
Include safe identifiers when available:
- correlationId
- parent and child Pulse execution ids
- qTest queue id and terminal state
- concise sanitized stdout/stderr

For an ambiguous Pulse 5xx, say whether the reconciliation procedure was
completed before retrying.
-->

## Environment

- qTest/Pulse version:
- Deployment: SaaS or on-premises
- Rule source revision:
- Delivery schema version, if applicable:
- Test tool/reporter and version, if applicable:
- Node.js version running `delivery.js`, if applicable:
- External provider/version, if applicable:

## Local validation

<!-- Paste the summary from `npm run validate`, not confidential test output. -->

## Proposed solution or compatibility impact

<!-- Optional. Identify any Trigger, Constant, payload, API, or migration change. -->
