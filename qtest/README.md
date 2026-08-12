# qTest Result Submission

The standard results pipeline uses two qTest Actions:

1. `UpdateQTestWithResults.js` submits parsed automation logs.
2. `CheckProcessingQueue.js` optionally monitors the asynchronous qTest queue
   until it succeeds or reaches a terminal failure or configured limit.

Parsers never select a qTest API URL. They send a destination and `logs` to the
single `UpdateQTestWithResults` Trigger; that Action owns endpoint and request
body selection.

## Pulse objects to configure

Create these objects with the exact Trigger names shown:

| Pulse object | Name/source | Required |
| --- | --- | --- |
| Trigger | `UpdateQTestWithResults` | Yes |
| Action | Source from `qtest/UpdateQTestWithResults.js` | Yes |
| Rule | Connect `UpdateQTestWithResults` to its Action | Yes |
| Trigger | `CheckProcessingQueue` | Recommended for queue monitoring |
| Action | Source from `qtest/CheckProcessingQueue.js` | Recommended |
| Rule | Connect `CheckProcessingQueue` to its Action | Recommended |
| Trigger and notification Action | `ChatOpsEvent` | Optional |

Every parser Action must be able to resolve the
`UpdateQTestWithResults` Trigger. When queue monitoring is enabled,
`CheckProcessingQueue` must be able to invoke its own Trigger for the next
bounded polling attempt. Do not rename these Triggers unless the corresponding
source call is changed too.

## Constants

Both qTest Actions require:

| Constant | Value |
| --- | --- |
| `QTEST_TOKEN` | qTest bearer token from Resources > API & SDK |
| `ManagerURL` | qTest Manager hostname only, such as `example.qtestnet.com`; do not include `http://`, `https://`, a path, query, fragment, or trailing slash |

Optional tuning constants:

| Constant | Default | Purpose |
| --- | ---: | --- |
| `QTEST_REQUEST_TIMEOUT_MS` | Submission: 120000; queue check: 30000 | HTTP request timeout |
| `QTEST_QUEUE_MAX_ATTEMPTS` | 20 | Maximum queue checks |
| `QTEST_QUEUE_POLL_DELAY_MS` | 5000 | Delay between queue checks |
| `QTEST_QUEUE_TIMEOUT_MS` | 600000 | Maximum elapsed queue-monitoring time |

Use a dedicated qTest service account when the workflow must submit to
multiple projects, and grant only the permissions those projects require.

## Submission payloads

The preferred Test Cycle payload is:

```json
{
  "deliverySchemaVersion": 2,
  "correlationId": "delivery-generated-uuid",
  "projectId": "123",
  "targetType": "test-cycle",
  "targetId": "456",
  "testcycle": "456",
  "logs": [
    {
      "name": "Checkout test",
      "automation_content": "checkout-test",
      "status": "PASSED",
      "exe_start_date": "2026-08-06T14:00:00.000Z",
      "exe_end_date": "2026-08-06T14:00:01.000Z",
      "module_names": ["Examples"]
    }
  ]
}
```

The preferred Test Suite payload is:

```json
{
  "deliverySchemaVersion": 2,
  "correlationId": "delivery-generated-uuid",
  "projectId": "123",
  "targetType": "test-suite",
  "targetId": "TS-456",
  "testsuite": "TS-456",
  "logs": [
    {
      "name": "Checkout test",
      "automation_content": "checkout-test",
      "status": "PASSED",
      "exe_start_date": "2026-08-06T14:00:00.000Z",
      "exe_end_date": "2026-08-06T14:00:01.000Z",
      "module_names": ["Examples"]
    }
  ]
}
```

`targetId` may be the qTest destination id/PID accepted by the corresponding
API. Provide exactly one object type. If canonical and compatibility fields
conflict, or both `testcycle` and `testsuite` are supplied, the Action fails
before making a qTest request.

### UpdateQTestWithResults.js

Test Cycle submissions use the v3 auto-test-logs endpoint and preserve parser
step order. Test Suite submissions use the v3.1 endpoint, add the required
execution date, and apply zero-based order to a copy of each step log without
mutating parser output.

The canonical endpoint reference is the [qTest API documentation](https://qtest.dev.tricentis.com/).

On acceptance, qTest returns an asynchronous processing queue id. The Action
logs it and invokes `CheckProcessingQueue` when that Trigger is configured.
Submission is not retried automatically because an uncoordinated retry could
create duplicate qTest results.

Pulse `5xx` errors received while invoking another Trigger are classified as
an unknown child-execution outcome rather than a confirmed failure. The child
may already exist and may already have submitted to qTest. Do not retry until
the `correlationId` has been reconciled using the
[Pulse invocation reconciliation procedure](../docs/PULSE_INVOCATION_RECONCILIATION.md).

### CheckProcessingQueue.js

This Action checks one queue state per execution. While qTest returns
`IN_WAITING`, `IN_PROCESSING`, or `PENDING`, it waits for the configured delay
and invokes one correlated follow-up execution. `SUCCESS` completes normally;
`FAILED`, an unknown state, exhausted attempts, or elapsed timeout fails
explicitly. ChatOps notification is optional.

## Identifier glossary

These identifiers describe different systems and must not be interchanged:

| Identifier | Meaning |
| --- | --- |
| `correlationId` | Trace value carried through delivery, parser, submission, and queue monitoring |
| Pulse execution id | Identifies one downstream Pulse Action execution created by `Webhooks.invoke` |
| qTest queue id | Identifies qTest's asynchronous processing job returned by auto-test-logs |
| `targetId` | Identifies the destination Test Cycle or Test Suite |

A Pulse execution id proves Pulse accepted a downstream invocation. It does not
prove qTest processed the results. The qTest queue id and terminal queue state
are the authoritative submission outcome. The correlation id is searchable
context, not an idempotency key.

## UFT Warning prerequisite

`parsers/UFTXML.js` preserves the exact `Warning` status. Before using that
parser, create or activate a qTest execution status named `Warning` and map the
incoming automation status `Warning` to it in qTest Automation Settings.
Otherwise, qTest can reject the submitted log.

## Legacy specialized integrations

The remaining `qtest` subdirectories contain older, specialized rules. They
have not yet received all validation, error normalization, correlation logging,
and asynchronous completion changes present in the standard results pipeline.
Treat them as reference implementations and review their source-level usage
headers before production use.

### azure-devops

These rules provide a limited synchronization example for Azure DevOps Boards:
ADO is the system of record for Requirements, while Defects originate in qTest
and receive limited ADO-to-qTest updates. Their modernization is planned after
the core result and CI work.

### jira

These legacy helpers create a basic qTest Test Case from a Jira webhook and
associate it with an existing Jira-backed qTest Requirement.

### scenario

These legacy helpers support the Scenario BDD plug-in for Jira. Their
specialized Test Cycle-only result submission uses
`UpdateQTestAndLinkScenarioRequirements`; do not connect that Action and the
standard `UpdateQTestWithResults` Action to the same parser event. The maintained
`CucumberJSON.js` source uses only the standard result pipeline and does not
perform Scenario requirement linking. See the
[Pulse Quick Start Guide](https://documentation.tricentis.com/qtest/od/en/content/pulse/qtest_pulse_quick_start_guide.htm)
for product-level Pulse prerequisites.
