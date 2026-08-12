# Pulse Marketplace Repository Catalog

Current release inventory reviewed: 2026-08-12

Release target: `v3.0.0`

This catalog treats JavaScript Action files as the maintainable rule sources.
The Azure DevOps synchronization JSON is a historical embedded snapshot rather
than a separate source item and is not maintained in lockstep with its source
Actions.

## Inventory Summary

| Category | Source items | Supporting items | Purpose |
| --- | ---: | ---: | --- |
| ChatOps | 2 actions | 1 README | Send provider-neutral notifications to collaboration tools |
| CI tools | 9 actions | 1 README | Trigger pipelines across self-managed and hosted CI providers |
| Results delivery | 1 script | 1 README | Read a result file and post it to a parser webhook |
| Result parsers | 15 actions | 1 README | Convert tool-specific JSON/XML into qTest automation logs |
| Core qTest | 2 actions | 1 README | Submit formatted logs and monitor the processing queue |
| Azure DevOps | 3 actions | 1 snapshot, 1 README | Synchronize requirements and defects between ADO and qTest |
| Jira | 2 actions | 1 README | Create and link qTest test cases from Jira requirements |
| Scenario | 3 actions | 1 README | Link Scenario requirements and update BDD step results |
| Repository assets | 0 | 5 images | Diagrams, logo, and setup illustration |
| Project governance | 0 | 10 files | Release history, contribution, conduct, licensing, formatting, and GitHub templates |
| Development harness | 0 | 8 files | Package metadata, documentation/syntax checks, tests, and fixture |
| Maintenance documentation | 0 | 3 files | Catalog, migration, and reconciliation procedure |
| **Total** | **37 source files** | **35 supporting files** | **72 current files, excluding dependencies and Git metadata** |

## Common Rule Contracts

### Parser input

Delivery contract version 2 is self-describing. JSON is sent as a native object
or array:

```json
{
  "deliverySchemaVersion": 2,
  "correlationId": "delivery-generated-uuid",
  "projectId": "123",
  "targetType": "test-cycle",
  "targetId": "456",
  "testcycle": "456",
  "resultFormat": "json",
  "resultEncoding": "identity",
  "result": {}
}
```

XML/TRX is Base64-encoded directly from the result-file bytes:

```json
{
  "deliverySchemaVersion": 2,
  "correlationId": "delivery-generated-uuid",
  "projectId": "123",
  "targetType": "test-suite",
  "targetId": "TS-456",
  "testsuite": "TS-456",
  "resultFormat": "xml",
  "resultEncoding": "base64",
  "result": "<Base64-encoded result file>"
}
```

The four delivery-fed JSON parsers also accept the legacy unversioned envelope:

```json
{
  "projectId": "123",
  "testcycle": "456",
  "result": "<Base64-encoded result file>"
}
```

All ten XML/TRX parsers continue to decode the Base64 `result` before parsing XML.
`SonarQubeJSON.js` is outside this contract: it receives JSON from a SonarQube
webhook rather than from the delivery script. Its qTest destination comes from
`QTEST_PROJECT_ID`, `QTEST_TARGET_TYPE`, and `QTEST_TARGET_ID` Pulse constants
or the source-level defaults.

### Parser output

All parser sources await `UpdateQTestWithResults` as a required Pulse event.
They propagate correlation metadata, log every returned child Pulse execution
record, and treat ChatOps notifications as optional. XML/TRX parsing completes
before submission.

Every parser builds the same conceptual payload:

```json
{
  "projectId": "123",
  "targetType": "test-suite",
  "targetId": "TS-456",
  "testsuite": "TS-456",
  "logs": []
}
```

Every parser now invokes the single `UpdateQTestWithResults` trigger and
forwards canonical destination metadata plus exactly one `testcycle` or
`testsuite` compatibility field. The unified action owns qTest API endpoint and
request-body selection.

### Base64 boundaries

There are three unrelated uses of Base64 in this repository:

1. Delivery envelope encoding of complete result files.
2. qTest attachment data created by parsers.
3. HTTP Basic authentication in selected integrations.

Contract version 2 removes the first use from JSON delivery while retaining it
for XML/TRX. Attachment encoding and Basic authentication remain governed by
their own API contracts.

## ChatOps Actions

| Item | Input / trigger | Configuration | Behavior |
| --- | --- | --- | --- |
| [`chatops/MSTeamsPowerAutomate.js`](../chatops/MSTeamsPowerAutomate.js) | `ChatOpsEvent`; reads `event.message` and optional `event.correlationId` | `TeamsWebhook`; optional `TEAMS_MESSAGE_MAX_CHARACTERS`, `TEAMS_REQUEST_TIMEOUT_MS` | Posts the Microsoft-documented Adaptive Card envelope through Axios, with HTTPS validation, bounded truncation and timeout, sanitized structured logging, returned delivery metadata, and explicit error propagation. |
| [`chatops/SlackMessage.js`](../chatops/SlackMessage.js) | `ChatOpsEvent`; reads `event.message` | `SlackWorkflowWebhook`; optional `SLACK_MESSAGE_MAX_CHARACTERS`, `SLACK_REQUEST_TIMEOUT_MS` | Posts through the Pulse-provided Axios client to a Slack Workflow Builder `/triggers/` webhook, with bounded truncation, an explicit sub-container timeout, sanitized structured logging, and the sanitized transport cause in the execution error. |

Both provider Actions can be connected to the same `ChatOpsEvent` Trigger so
calling Actions remain provider-agnostic. See the
[`chatops` setup guide](../chatops/README.md). The former Slack attachment
Action and its `SlackAttachmentEvent` Trigger are retired because they used the
discontinued Slack `files.upload` API.

## CI Tool Actions

All nine CI Actions validate configuration, use bounded HTTP timeouts, return
provider run metadata, throw primary dispatch failures, and can emit correlated
`ChatOpsEvent` notifications after an accepted or failed request. Optional
ChatOps failures are logged without masking the primary CI outcome. See the
[`citools` setup guide](../citools/README.md).

| Item | Configuration | Behavior |
| --- | --- | --- |
| [`citools/TriggerBamboo.js`](../citools/TriggerBamboo.js) | `BambooUserName`, `BambooPassword`, `BambooURL`, `BambooProjectCode` | Queues a Bamboo plan with Axios Basic authentication; retains host-only URL compatibility with an HTTP warning. |
| [`citools/TriggerJenkins.js`](../citools/TriggerJenkins.js) | `JenkinsUserName`, `JenkinsAPIToken`, `JenkinsURL`, `JenkinsJobName`, `JenkinsJobToken`; compatibility alias `JenkinsParamJob` | Gets the dynamic Jenkins crumb header and selects `/build` or `/buildWithParameters` from the event. Supports general `event.parameters` and legacy `event.tag` without embedding credentials in URLs. |
| [`citools/TriggerTeamCity.js`](../citools/TriggerTeamCity.js) | `TeamCityUserName`, `TeamCityPassword`, `TeamCityURL`, `TeamCityBuildCode`; legacy `TeamCityPort` | Posts an XML-escaped build request and requests a JSON response containing build metadata. |
| [`citools/TriggerGitHubActions.js`](../citools/TriggerGitHubActions.js) | `GitHubOwner`, `GitHubRepository`, `GitHubWorkflow`, `GitHubToken`, default `GitHubRef` | Dispatches a `workflow_dispatch` workflow with event ref and inputs. |
| [`citools/TriggerGitLabPipeline.js`](../citools/TriggerGitLabPipeline.js) | `GitLabProjectId`, `GitLabTriggerToken`, default `GitLabRef`; optional `GitLabURL` | Triggers GitLab.com or self-managed pipelines with variables and typed inputs. |
| [`citools/TriggerAzurePipeline.js`](../citools/TriggerAzurePipeline.js) | `AzureDevOpsOrganization`, `AzureDevOpsProject`, `AzureDevOpsPipelineId`, `AzureDevOpsToken` | Runs Azure Pipelines API v7.1 with optional refs, variables, resources, template parameters, and skipped stages. |
| [`citools/TriggerCircleCIPipeline.js`](../citools/TriggerCircleCIPipeline.js) | `CircleCIProvider`, `CircleCIOrganization`, `CircleCIProject`, `CircleCIPipelineDefinitionId`, `CircleCIToken` | Uses CircleCI's current pipeline-definition run endpoint with branch/tag checkout and parameters. |
| [`citools/TriggerBitbucketPipeline.js`](../citools/TriggerBitbucketPipeline.js) | `BitbucketWorkspace`, `BitbucketRepository`, `BitbucketToken`, default `BitbucketBranch`; optional `BitbucketUserName` | Runs a branch/tag pipeline with optional commit, custom selector, and secured variables; supports Bearer or account-email/API-token Basic authentication. |
| [`citools/TriggerBuildkiteBuild.js`](../citools/TriggerBuildkiteBuild.js) | `BuildkiteOrganization`, `BuildkitePipeline`, `BuildkiteToken`, default `BuildkiteBranch` | Creates a Buildkite build with optional commit, environment, metadata, author, and clean checkout. |

## Results Delivery

| Item | Behavior | Current contract / notes |
| --- | --- | --- |
| [`delivery/node.js/delivery.js`](../delivery/node.js/delivery.js) | Optionally executes a configured command, detects JSON versus XML/TRX, selects a Test Cycle or Test Suite destination, constructs a v2 envelope, checks its serialized size, and posts it with built-in `fetch`. | Requires no npm dependencies. JSON is validated and sent natively; XML/TRX is Base64-encoded from the original bytes. |
| [`delivery/README.md`](../delivery/README.md) | Documents runtime requirements, format detection, configuration, and both v2 envelope variants. | Clarifies that Base64 is compatibility encoding rather than a security control. |

## Result Parser Actions

### JSON parsers

| Item | Source format | Result input | Main mapping | Emits |
| --- | --- | --- | --- | --- |
| [`parsers/Allure2.0JSON.js`](../parsers/Allure2.0JSON.js) | Allure 2 JSON result object(s) | v2 native JSON or legacy Base64 JSON | Maps Allure labels, steps, status details, timing, and failure attachment data. | `UpdateQTestWithResults` |
| [`parsers/CucumberJSON.js`](../parsers/CucumberJSON.js) | Cucumber for Java 4+ JSON | v2 native JSON or legacy Base64 JSON | Maps features to modules, scenarios to test logs, steps and embeddings to qTest steps and attachments. The maintained source uses the standard result pipeline and does not perform legacy Scenario linking. | `UpdateQTestWithResults`, `ChatOpsEvent` |
| [`parsers/CypressMochawesomeJSON.js`](../parsers/CypressMochawesomeJSON.js) | Consolidated Cypress Mochawesome JSON | v2 native JSON or legacy Base64 JSON | Maps suites and tests, stats dates, code, UUID automation content, and failure notes. | `UpdateQTestWithResults`, `ChatOpsEvent` |
| [`parsers/PostmanJSON.js`](../parsers/PostmanJSON.js) | Postman/Newman JSON | v2 native JSON or legacy Base64 JSON | Maps executions and assertions into test logs and step results, including response status details. | `UpdateQTestWithResults` |
| [`parsers/SonarQubeJSON.js`](../parsers/SonarQubeJSON.js) | SonarQube webhook JSON | Direct SonarQube webhook; not delivery-script input | Maps quality-gate conditions into qTest test logs and steps. Its input contract remains separate from delivery schema versioning, but it uses the unified submission trigger. | `UpdateQTestWithResults` |

### XML and TRX parsers

All ten consume a Base64-encoded text result and use `xml2js`.

| Item | Source format | Main mapping | Emits |
| --- | --- | --- | --- |
| [`parsers/AllureXML.js`](../parsers/AllureXML.js) | Allure XML | Maps Allure test-suite cases and steps, including epoch timing. | `UpdateQTestWithResults` |
| [`parsers/JUnitXML.js`](../parsers/JUnitXML.js) | JUnit-style XML | Maps suites and cases, supports colon-delimited module paths, calculates timing, and adds failure attachments. Intended to cover XUnit, JBehave, and JMeter variants. | `UpdateQTestWithResults`, `ChatOpsEvent` |
| [`parsers/NUnitXML.js`](../parsers/NUnitXML.js) | NUnit XML | Maps method-level test results without detailed steps and attaches failure details. | `UpdateQTestWithResults`, `ChatOpsEvent` |
| [`parsers/ReadyAPIXML.js`](../parsers/ReadyAPIXML.js) | ReadyAPI XML | Maps suites, cases, and ReadyAPI steps; collects failure details as attachments. | `UpdateQTestWithResults`, `ChatOpsEvent` |
| [`parsers/RobotXML.js`](../parsers/RobotXML.js) | Robot Framework XML | Maps a high-level, non-nested suite into qTest tests and steps. | `UpdateQTestWithResults`, `ChatOpsEvent` |
| [`parsers/SpecflowTRX.js`](../parsers/SpecflowTRX.js) | Legacy SpecFlow TRX | Maps test definitions and unit test results, with standard-output attachments. | `UpdateQTestWithResults`, `ChatOpsEvent` |
| [`parsers/TestNGXML.js`](../parsers/TestNGXML.js) | TestNG XML | Maps suites/classes/methods, filters housekeeping methods, supports parameters, and creates failure attachments. | `UpdateQTestWithResults`, `ChatOpsEvent` |
| [`parsers/ToscaXML.js`](../parsers/ToscaXML.js) | ToscaCI XML | Parses Tosca's plaintext log field into steps and creates a failure attachment. | `UpdateQTestWithResults`, `ChatOpsEvent` |
| [`parsers/UFTXML.js`](../parsers/UFTXML.js) | OpenText UFT run results XML | Recursively maps UFT test runs, contexts, user steps, warnings, snapshots, and stack traces. | `UpdateQTestWithResults`, `ChatOpsEvent` |
| [`parsers/WorksoftCertifyXML.js`](../parsers/WorksoftCertifyXML.js) | Worksoft Certify XML | Groups logged step records into test cases and derives aggregate case status. | `UpdateQTestWithResults`, `ChatOpsEvent` |

### Parser documentation

[`parsers/README.md`](../parsers/README.md) describes the parser family and all
current parser sources, including the direct-webhook SonarQube exception.

## Core qTest Actions

| Item | Input / trigger | Configuration | Behavior |
| --- | --- | --- | --- |
| [`qtest/UpdateQTestWithResults.js`](../qtest/UpdateQTestWithResults.js) | Standard parser output with destination metadata | `QTEST_TOKEN`, `ManagerURL` | Selects Test Cycle v3 or Test Suite v3.1 submission, logs the qTest queue id, and emits `CheckProcessingQueue`. |
| [`qtest/CheckProcessingQueue.js`](../qtest/CheckProcessingQueue.js) | Correlated queue metadata | `QTEST_TOKEN`, `ManagerURL` | Reads queue state and schedules bounded follow-up checks while the state is waiting, processing, or pending. Emits terminal status through `ChatOpsEvent`. |
| [`qtest/README.md`](../qtest/README.md) | Documentation | — | Documents exact Trigger/Action/Rule prerequisites, constants, cycle/suite payloads, queue behavior, identifier meanings, and the UFT Warning prerequisite. |

## Azure DevOps Integration

The marketplace implementation assumes Azure DevOps is the system of record.
Requirements flow from ADO to qTest. Defects are created in qTest, copied to ADO,
and then receive limited ADO-to-qTest updates.

| Item | Direction | Configuration | Behavior |
| --- | --- | --- | --- |
| [`qtest/azure-devops/CreateDefectInAzureDevops.js`](../qtest/azure-devops/CreateDefectInAzureDevops.js) | qTest → ADO | `QTEST_TOKEN`, `AZDO_TOKEN`, `ManagerURL`, `ProjectID`, `AzDoProjectURL`, summary/description field ids | Retries until a new qTest defect is fully saved, creates an ADO Bug with a qTest hyperlink, then prefixes the qTest summary with `WI<id>:`. |
| [`qtest/azure-devops/SyncDefectFromAzureDevopsWorkItem.js`](../qtest/azure-devops/SyncDefectFromAzureDevopsWorkItem.js) | ADO → qTest | `QTEST_TOKEN`, `ManagerURL`, `ProjectID`, summary/description field ids | On ADO update, searches for the linked qTest defect by `WI<id>:` and rewrites summary and description. ADO create/delete events are intentionally ignored. |
| [`qtest/azure-devops/SyncRequirementFromAzureDevopsWorkItem.js`](../qtest/azure-devops/SyncRequirementFromAzureDevopsWorkItem.js) | ADO → qTest | `QTEST_TOKEN`, `ManagerURL`, `ProjectID`, `RequirementParentID`, `RequirementDescriptionFieldID`, `AllowCreationOnUpdate` | Creates, updates, or deletes a qTest requirement based on ADO work item events and links records through the `WI<id>:` name prefix. |
| [`qtest/azure-devops/synchronization.json`](../qtest/azure-devops/synchronization.json) | Historical import snapshot | Ten constants, three triggers, three actions, three rules | Not maintained in lockstep with the source files. Configure the reviewed source Actions individually instead. |
| [`qtest/azure-devops/README.md`](../qtest/azure-devops/README.md) | Documentation | — | Documents supported ADO process models, webhook setup, constants, system-of-record assumptions, and rate-limit limitations. |

## Jira Integration

| Item | Input / trigger | Configuration | Behavior |
| --- | --- | --- | --- |
| [`qtest/jira/CreateTestCaseFromJira.js`](../qtest/jira/CreateTestCaseFromJira.js) | Jira webhook payload | `QTEST_TOKEN`, `ManagerURL`, `ProjectID` | Creates a default qTest test case for `event.issue.key`, then emits `LinkRequirement`. |
| [`qtest/jira/LinkRequirement.js`](../qtest/jira/LinkRequirement.js) | `{ "tcid": ..., "issueKey": ... }` | `QTEST_TOKEN`, `ManagerURL`, `ProjectID` | Searches for the Jira-backed qTest requirement and links it to the supplied test case. |
| [`qtest/jira/README.md`](../qtest/jira/README.md) | Documentation | — | Describes the two-action Jira workflow and its integration prerequisites. |

## Scenario Integration

| Item | Input / trigger | Configuration | Behavior |
| --- | --- | --- | --- |
| [`qtest/scenario/UpdateQTestAndLinkScenarioRequirements.js`](../qtest/scenario/UpdateQTestAndLinkScenarioRequirements.js) | Scenario-aware Cucumber parser output; Test Cycle only | `QTEST_TOKEN`, `ManagerURL` | Submits automation logs, polls the processing queue, then emits `LinkScenarioRequirements`. This is separate from the maintained standard submission path. |
| [`qtest/scenario/LinkScenarioRequirements.js`](../qtest/scenario/LinkScenarioRequirements.js) | Parsed Cucumber logs | `QTEST_TOKEN`, `ManagerURL`, `ScenarioProjectID`, `ScenarioURL` | Resolves Scenario features to Jira issues, finds matching qTest Test Cases and Requirements, and links them. |
| [`qtest/scenario/UpdateScenarioWithResults.js`](../qtest/scenario/UpdateScenarioWithResults.js) | Parsed logs and step metadata | `QTEST_TOKEN`, `ScenarioProjectID`, `Scenario_URL` | Uses the Scenario SDK to update line-by-line step status coloring. |
| [`qtest/scenario/README.md`](../qtest/scenario/README.md) | Documentation | — | Describes the legacy Scenario BDD workflow and its compatibility boundaries. |

## Repository Assets

| Item | Purpose |
| --- | --- |
| [`blob/qas-ico-logo-150x150.png`](../blob/qas-ico-logo-150x150.png) | qTest/Pulse logo used in the root README. |
| [`blob/pulse-flow.png`](../blob/pulse-flow.png) | High-level Pulse rule flow diagram. |
| [`blob/Pulse & Scenario Workflow Diagram.png`](../blob/Pulse%20%26%20Scenario%20Workflow%20Diagram.png) | Scenario workflow overview. |
| [`blob/Pulse & Tosca Workflow Diagram.png`](../blob/Pulse%20%26%20Tosca%20Workflow%20Diagram.png) | Tosca workflow overview. |
| [`blob/qTestPrjTCIds.png`](../blob/qTestPrjTCIds.png) | Illustration showing qTest project and test-cycle ids in the UI URL. |

## Project Governance and Configuration

| Item | Purpose |
| --- | --- |
| [`README.md`](../README.md) | Marketplace overview, architecture, setup guidance, and workflow narrative. |
| [`CHANGELOG.md`](../CHANGELOG.md) | Versioned additions, changes, fixes, removals, and migration impact. |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Contribution process and expectations. |
| [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | Contributor Covenant-based conduct policy. |
| [`DISCLAIMER.md`](../DISCLAIMER.md) | Warranty and liability disclaimer. |
| [`LICENSE.md`](../LICENSE.md) | MIT license. |
| [`.gitignore`](../.gitignore) | Git ignore rules. |
| [`.prettierrc`](../.prettierrc) | Prettier formatting preferences. |
| [`.github/ISSUE_TEMPLATE/defect-or-enhancement-issue.md`](../.github/ISSUE_TEMPLATE/defect-or-enhancement-issue.md) | Combined defect/enhancement issue template. |
| [`.github/PULL_REQUEST_TEMPLATE/pull_request_template.md`](../.github/PULL_REQUEST_TEMPLATE/pull_request_template.md) | Pull-request checklist and submission template. |

## Development Harness

| Item | Purpose |
| --- | --- |
| [`package.json`](../package.json) | Repository-only scripts and development dependency declaration. |
| [`package-lock.json`](../package-lock.json) | Reproducible development dependency resolution. |
| [`scripts/check-syntax.js`](../scripts/check-syntax.js) | Syntax-checks every repository JavaScript file without executing Pulse Actions. |
| [`scripts/check-documentation.js`](../scripts/check-documentation.js) | Validates local Markdown links/anchors, rejects retired targets and private paths, and enforces leading rule usage blocks. |
| [`test/chatops.test.js`](../test/chatops.test.js) | ChatOps contracts, URL validation, timeouts, redaction, and retired Slack attachment checks. |
| [`test/ci-tools.test.js`](../test/ci-tools.test.js) | CI provider dispatch, authentication, parameter, error, redaction, and ChatOps tests. |
| [`test/result-pipeline.test.js`](../test/result-pipeline.test.js) | Delivery, parser, qTest submission, queue, destination, correlation, and ambiguity tests. |
| [`test/fixtures/uft-warning.xml`](../test/fixtures/uft-warning.xml) | Sanitized UFT Warning transformation fixture. |

## Maintenance Documentation

| Item | Purpose |
| --- | --- |
| [`docs/REPOSITORY_CATALOG.md`](REPOSITORY_CATALOG.md) | This inventory and contract catalog. |
| [`docs/MIGRATING_TO_V3.md`](MIGRATING_TO_V3.md) | Ordered upgrade procedure and v2-to-v3 contract mapping. |
| [`docs/PULSE_INVOCATION_RECONCILIATION.md`](PULSE_INVOCATION_RECONCILIATION.md) | Operator procedure for ambiguous downstream Pulse 5xx outcomes. |
