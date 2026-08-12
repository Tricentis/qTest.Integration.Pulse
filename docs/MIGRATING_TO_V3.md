# Migrating from v2 to v3

Version 3 modernizes the result, ChatOps, and CI paths and removes unsupported
or superseded deployment artifacts. Upgrade a non-production Pulse project
first. Do not enable old and new submission Rules in parallel; a parser event
that reaches both paths can create duplicate qTest results.

## Before You Change Pulse

1. Record every current Trigger, Action, Rule, and Constant name.
2. Preserve the current Action source and Rule connections outside Pulse or in
   an approved configuration record.
3. Identify inbound webhook URLs that external delivery systems already use.
   Updating the Action behind an existing parser Rule can preserve that inbound
   URL.
4. Select disposable qTest Test Cycle and Test Suite destinations for testing.
5. Plan a maintenance window in which old result-submission Rules can be
   disabled before the replacement path is enabled.
6. Keep the repository's `v2.0.0` tag as the source reference for rollback.

## Replacement Map

| v2 object or behavior | v3 replacement or action |
| --- | --- |
| `UpdateQTestWithFormattedResults` Trigger | Create or rename to exactly `UpdateQTestWithResults` |
| `UpdateQTestWithFormattedResultsEvent` Trigger | Create or rename to exactly `UpdateQTestWithResults` |
| Parser-specific endpoint switching | Pass destination metadata to `UpdateQTestWithResults` |
| Slack attachment Action / `SlackAttachmentEvent` | `SlackMessage.js` connected to `ChatOpsEvent` |
| Slack Incoming Webhook or file upload | Slack Workflow Builder webhook stored in `SlackWorkflowWebhook` |
| Separate parameterized Jenkins Action | `TriggerJenkins.js` with `event.parameters` |
| `JenkinsParamJob` Constant | Prefer `JenkinsJobName`; the old name remains a compatibility alias |
| Embedded import bundle | Configure the reviewed standalone Action sources and Rules individually |
| Axios-dependent delivery script | Dependency-free `delivery/node.js/delivery.js` using built-in `fetch` |

Retired Trigger names may remain temporarily while old parsers are disabled,
but no maintained v3 parser invokes them. Remove their Rules after every parser
has been migrated and verified.

## Update the qTest Result Objects

Create or update these Pulse objects first:

| Object | Required name/source |
| --- | --- |
| Trigger | `UpdateQTestWithResults` |
| Action | Complete source from `qtest/UpdateQTestWithResults.js` |
| Rule | Connect `UpdateQTestWithResults` to that Action exactly once |
| Trigger | `CheckProcessingQueue`, recommended |
| Action | Complete source from `qtest/CheckProcessingQueue.js`, recommended |
| Rule | Connect `CheckProcessingQueue` to that Action exactly once |
| Trigger | `ChatOpsEvent`, optional |

Both qTest Actions require:

| Constant | v3 value |
| --- | --- |
| `QTEST_TOKEN` | qTest bearer token with access to the destination project |
| `ManagerURL` | Hostname only, such as `example.qtestnet.com`; no protocol, path, query, fragment, or trailing slash |

The Actions enforce HTTPS internally. A value such as
`https://example.qtestnet.com/` is invalid in v3.

See the [qTest results guide](../qtest/README.md) for queue-monitor tuning
Constants and the complete submission contract.

## Update Delivery and Parsers

Replace the delivery script with `delivery/node.js/delivery.js`. It needs a
current Node.js LTS release with built-in `fetch`; do not install Axios or an XML
parser for delivery.

Configure one destination:

```javascript
const targetType = "test-cycle"; // or "test-suite"
const targetId = "456";          // destination id/PID
```

Delivery contract version 2 sends JSON as a native object or array:

```json
{
  "deliverySchemaVersion": 2,
  "projectId": "123",
  "targetType": "test-cycle",
  "targetId": "456",
  "resultFormat": "json",
  "resultEncoding": "identity",
  "result": {}
}
```

XML and TRX remain byte-preserving Base64 strings:

```json
{
  "deliverySchemaVersion": 2,
  "projectId": "123",
  "targetType": "test-suite",
  "targetId": "TS-456",
  "resultFormat": "xml",
  "resultEncoding": "base64",
  "result": "PHRlc3RzdWl0ZT4uLi48L3Rlc3RzdWl0ZT4="
}
```

The delivery script also adds `correlationId` and exactly one compatibility
field, `testcycle` or `testsuite`. Do not manually send both.

For each parser:

1. Replace the complete Action source with its v3 repository version.
2. Keep the inbound parser Trigger and Rule when preserving the webhook URL.
3. Confirm the parser can resolve exactly one `UpdateQTestWithResults` Trigger.
4. Disable the old formatted-results Rule before running the v3 parser.
5. Deliver once to a Test Cycle and once to a Test Suite.
6. Confirm exactly one qTest processing queue id is produced per delivery.

`SonarQubeJSON.js` remains a direct SonarQube webhook Action and never receives
the delivery envelope. Configure its destination with `QTEST_PROJECT_ID`,
`QTEST_TARGET_TYPE`, and `QTEST_TARGET_ID` as described in the
[parser guide](../parsers/README.md#sonarqube-direct-webhook).

The specialized Scenario Actions remain separate legacy implementations. Do
not connect their Test Cycle-only submission Action to the same event as the
standard Cucumber result path.

## Update ChatOps

Calling Actions should invoke only:

```json
{
  "correlationId": "trace-id",
  "source": "UFTXML",
  "message": "qTest queued one result."
}
```

Connect any desired provider Actions to the same `ChatOpsEvent` Trigger:

- Slack: use `chatops/SlackMessage.js` and store the Slack Workflow Builder
  `/triggers/` URL in `SlackWorkflowWebhook`.
- Teams: use `chatops/MSTeamsPowerAutomate.js` and store the Power Automate
  callback URL in `TeamsWebhook`.

Remove old Rules connected to `SlackAttachmentEvent`. Long notifications are
truncated safely; v3 does not upload a file.

Follow the [ChatOps guide](../chatops/README.md) for provider workflow and
permission setup.

## Update CI Actions

Replace Bamboo, Jenkins, and TeamCity source with their v3 versions. For
parameterized Jenkins calls, send a general object:

```json
{
  "correlationId": "trace-id",
  "parameters": {
    "Tag": "smoke",
    "Environment": "qa"
  }
}
```

The legacy `tag` input is still mapped to the `Tag` parameter. New installations
should use `JenkinsJobName` and `parameters`.

Version 3 also adds GitHub Actions, GitLab CI/CD, Azure Pipelines, CircleCI,
Bitbucket Pipelines, and Buildkite. Each provider is opt-in and requires its own
Action, Constants, and Rule. See the [CI provider guide](../citools/README.md).

## Interpret Execution and Queue Logs

The identifiers in v3 are intentionally different:

| Identifier | Meaning |
| --- | --- |
| `correlationId` | Trace context preserved across the full chain |
| Pulse execution id | One child Action execution created by `Webhooks.invoke` |
| qTest queue id | qTest's asynchronous result-processing job |

A child Pulse execution id does not prove qTest finished processing. Verify the
qTest queue's terminal status.

If Pulse returns a 5xx while invoking a child, v3 reports an unknown outcome and
does not retry automatically. The child may already be running. Follow the
[reconciliation procedure](PULSE_INVOCATION_RECONCILIATION.md) before retrying.

## Upgrade Verification Checklist

- [ ] `ManagerURL` contains only the qTest Manager hostname.
- [ ] Each maintained parser invokes only `UpdateQTestWithResults`.
- [ ] Only one Rule handles `UpdateQTestWithResults`.
- [ ] Only one Rule handles each parser's inbound webhook.
- [ ] JSON works against a disposable Test Cycle and Test Suite.
- [ ] XML/UFT works against a disposable Test Cycle and Test Suite.
- [ ] Each delivery produces exactly one qTest queue id.
- [ ] Pulse child execution ids and qTest queue ids appear in logs.
- [ ] Slack and Teams receive the neutral `ChatOpsEvent` payload when enabled.
- [ ] Standard and parameterized Jenkins runs each create one build.
- [ ] Retired Triggers and Rules have been removed after migration.
- [ ] Tokens, signed webhook URLs, and full result bodies do not appear in logs.

## Rollback

Disable the v3 Rules before restoring v2 Action source and Rule connections.
Use the `v2.0.0` repository tag and the configuration record created before the
upgrade. Reconcile every ambiguous submission and inspect qTest before replaying
events; rolling back code does not undo results already accepted by qTest.
