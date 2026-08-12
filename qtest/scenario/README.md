# qTest Scenario BDD Helpers

These legacy reference Actions implement specialized behavior for the qTest
Scenario BDD plug-in for Jira: Test Cycle result submission, Jira Requirement
linking, and line-level Scenario step coloring.

They are separate from the maintained result pipeline. The maintained
`parsers/CucumberJSON.js` invokes `UpdateQTestWithResults` and does not
automatically invoke these Scenario helpers.

## Actions

| Action | Input | Constants | Downstream Triggers |
| --- | --- | --- | --- |
| `UpdateQTestAndLinkScenarioRequirements.js` | Parsed Cucumber `{ projectId, testcycle, logs }` | `QTEST_TOKEN`, `ManagerURL` | `LinkScenarioRequirements` required; `ChatOpsEvent` optional |
| `LinkScenarioRequirements.js` | Parsed Cucumber logs with feature/test-case names | `QTEST_TOKEN`, `ManagerURL`, `ScenarioProjectID`, `ScenarioURL` | None |
| `UpdateScenarioWithResults.js` | Logs containing Scenario-aware `test_step_logs` | `QTEST_TOKEN`, `ScenarioProjectID`, `Scenario_URL` | None |

`UpdateQTestAndLinkScenarioRequirements.js` submits to the qTest Test Cycle v3
endpoint, polls the queue in the same execution, and emits the original payload
to `LinkScenarioRequirements` after processing leaves the pending states.

`LinkScenarioRequirements.js` resolves Scenario features to Jira issue keys,
finds corresponding qTest Requirements and Test Cases, and links them.

`UpdateScenarioWithResults.js` uses the Scenario SDK to set matching steps to
`PASSED`, `FAILED`, or `SKIPPED`.

## Compatibility warning

- The specialized submission Action supports Test Cycles only.
- Do not connect the specialized and standard qTest submission Actions to the
  same event; that can submit duplicate automation logs.
- Constant spelling differs between the legacy sources: `ScenarioURL` and
  `Scenario_URL` are distinct. Preserve the source's exact names unless the
  rules are modernized together.
- The implementations use callback and polling patterns that do not yet meet
  the completion, error, correlation, or reconciliation standards of the
  maintained result pipeline.

See the official [qTest Pulse Quick Start
Guide](https://documentation.tricentis.com/qtest/od/en/content/pulse/qtest_pulse_quick_start_guide.htm)
for product-level access and Rule concepts, and the
[qTest API documentation](https://qtest.dev.tricentis.com/) for API contracts.
