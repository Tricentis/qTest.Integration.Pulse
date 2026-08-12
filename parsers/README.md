# Framework and Tool Parsers

These Pulse Actions translate tool-specific result documents into qTest
automation logs. Every maintained parser invokes the single Trigger named
`UpdateQTestWithResults`; the unified qTest Action selects the Test Cycle or
Test Suite endpoint.

Use the parser that matches the actual reporter output, not only the test
framework name. HTML reports are not supported. Consult the test tool's own
reporter documentation when enabling JSON, XML, or TRX output.

## Required Pulse wiring

For a delivery-fed parser:

1. Create an inbound webhook Trigger for the parser. Its name is local; its
   generated webhook URL becomes `delivery.js`'s `pulseUri`.
2. Create an Action from the complete selected parser source.
3. Create a Rule connecting the parser Trigger to the parser Action.
4. Create a Trigger named exactly `UpdateQTestWithResults` and connect it to an
   Action created from `qtest/UpdateQTestWithResults.js`.
5. Optionally create `ChatOpsEvent` and connect the Slack and/or Teams Actions.
6. Configure `delivery/node.js/delivery.js` with the project, destination, and
   result file.

The parser Action must be in a Pulse project where it can resolve the exact
`UpdateQTestWithResults` Trigger. Missing optional ChatOps wiring does not fail
result submission.

## Input contracts

| Parser family | Required result fields | Compatibility |
| --- | --- | --- |
| Delivery-fed JSON | `deliverySchemaVersion: 2`, `resultFormat: "json"`, `resultEncoding: "identity"`, native object/array in `result` | Also accepts the legacy unversioned Base64 JSON envelope |
| XML/TRX | `resultFormat: "xml"`, `resultEncoding: "base64"`, Base64 text in `result` | The result representation remains compatible with the legacy envelope |
| SonarQube | Direct SonarQube webhook JSON | Outside delivery schema versioning |

Every delivery-fed event also carries `projectId`, `targetType`, `targetId`,
and exactly one of `testcycle` or `testsuite`. The delivery script constructs
these fields; do not manually include both compatibility fields. See the
[delivery contract](../delivery/README.md).

All parsers preserve the incoming `correlationId`, await required submission,
log returned child Pulse execution ids/statuses, and treat ChatOps as optional.
A Pulse `5xx` while invoking the submission Trigger is an unknown child outcome
because the child may already have started. Automatic retry is disabled; use
the [reconciliation procedure](../docs/PULSE_INVOCATION_RECONCILIATION.md).

## Parser catalog

| Action | Expected source | Important behavior or limitation |
| --- | --- | --- |
| `Allure2.0JSON.js` | Allure 2 JSON | Maps labels, steps, timing, status details, and failure attachment data. |
| `AllureXML.js` | Allure XML | Maps test-suite cases and steps, including epoch timing. |
| `CucumberJSON.js` | Cucumber for Java 4+ JSON | Maps features, scenarios, steps, and embeddings. The maintained source uses the standard result pipeline and does not automatically perform historical Scenario requirement linking. |
| `CypressMochawesomeJSON.js` | Consolidated Cypress Mochawesome `report.json` | Maps nested suites, tests, code, dates, UUID automation content, and failure details. |
| `JUnitXML.js` | JUnit-style XML | Intended to cover compatible XUnit, JBehave, and JMeter variants; verify with a representative fixture because these dialects are not identical. |
| `NUnitXML.js` | NUnit XML | Reports test methods without detailed test steps and attaches failures. |
| `PostmanJSON.js` | Postman/Newman JSON | Maps executions and assertions, including response status details. Do not send HTML reporter output. |
| `ReadyAPIXML.js` | ReadyAPI XML | Maps suites, cases, and steps; expected results are primarily suite-level in this implementation. |
| `RobotXML.js` | Robot Framework XML | Supports a single high-level, non-nested suite; nested suites require enhancement and fixtures. |
| `SonarQubeJSON.js` | Direct SonarQube project-analysis webhook | Maps quality-gate conditions. Configure its qTest destination as described below; never invoke it through `delivery.js`. |
| `SpecflowTRX.js` | Legacy SpecFlow TRX | Does not support HTML or later non-TRX SpecFlow outputs. |
| `TestNGXML.js` | TestNG XML | Maps suites/classes/methods and parameters; Extent HTML is unsupported. |
| `ToscaXML.js` | ToscaCI XML | Parses Tosca plaintext log fields. It is separate from native Tosca/qTest and Launch flows and may require environment-specific adaptation. |
| `UFTXML.js` | OpenText UFT `run_results.xml` | Recursively maps runs, contexts, user steps, warnings, snapshots, and stack traces. Requires the qTest Warning status mapping described below. |
| `WorksoftCertifyXML.js` | Worksoft Certify XML | Groups logged steps into test cases and derives aggregate case status. |

## SonarQube direct webhook

Create a SonarQube webhook whose URL is the inbound Trigger connected to
`SonarQubeJSON.js`. Configure these Pulse Constants:

| Constant | Value |
| --- | --- |
| `QTEST_PROJECT_ID` | Destination qTest project id; `ProjectID` remains a compatibility alias |
| `QTEST_TARGET_TYPE` | `test-cycle` or `test-suite` |
| `QTEST_TARGET_ID` | Destination id/PID accepted by the selected qTest API |

Source-level defaults and the historical wrapped event shape remain for
compatibility, but Constants are preferred. The webhook must contain quality
gate conditions; an empty quality gate fails explicitly. See the official
[SonarQube webhook documentation](https://docs.sonarsource.com/sonarqube-server/discovering/integrations/webhooks)
for provider-side setup and payload details.

## UFT Warning prerequisite

`UFTXML.js` preserves UFT's exact `Warning` result. Before deployment, qTest
must have an active execution Status named `Warning` and an Automation Settings
mapping from incoming `Warning` to that status. Without the mapping, qTest can
reject the automation log.

## Scenario BDD distinction

The standard `CucumberJSON.js` source now invokes `UpdateQTestWithResults` like
every other maintained parser. The specialized files under `qtest/scenario`
are legacy reference implementations for requirement linking and Jira Scenario
step coloring. They support Test Cycle submission only and have not received
the current results-pipeline modernization. Do not connect both the standard
and legacy submission Actions to the same event, because that can duplicate
results.

## Creating or extending a parser

A parser should:

- accept the documented delivery-v2 representation and preserve documented
  legacy compatibility when applicable;
- validate its format before dereferencing tool-specific fields;
- create qTest log objects supported by the [qTest API](https://qtest.dev.tricentis.com/);
- copy canonical destination metadata and exactly one compatibility field;
- invoke only `UpdateQTestWithResults` for standard submission;
- await the required child invocation and log every returned execution id;
- keep ChatOps optional and avoid including complete result content in logs;
  and
- include a sanitized representative fixture and focused transformation test.

qTest Pulse parsers and qTest Launch/Universal Agent parsers are not assumed to
be interchangeable. Do not submit one result through both paths.
