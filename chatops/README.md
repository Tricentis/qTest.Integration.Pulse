# ChatOps Actions

Pulse Actions send provider-neutral notifications through the Trigger named
`ChatOpsEvent`:

```json
{
  "correlationId": "optional-cross-rule-id",
  "message": "The human-readable notification"
}
```

Connect both the Slack and Microsoft Teams Actions to `ChatOpsEvent` when both
destinations should receive the same notification. Calling Actions do not need
to know which providers are configured.

## Slack Workflow Builder

`SlackMessage.js` invokes a Slack Workflow Builder webhook using Axios, which is
already provided to Pulse Actions and is also used by the Teams and CI Actions.
It does not require a Slack app, a bot token, or file-upload permissions. The
implementation avoids the global `URL`, `fetch`, `AbortSignal`, and direct Node
HTTPS APIs because they are not exposed consistently by every Pulse container
runtime.

### Check permissions

Slack webhook-triggered workflows are available on paid plans. Workspace or
organization owners can restrict who may create workflows and use webhook
triggers. In Slack, open **Tools > Workflows** and look for **New** (or
**Create**) and the **From a webhook** start event. If either is unavailable,
ask a Slack owner or admin for permission to:

1. create and publish workflows;
2. use the **From a webhook** trigger; and
3. post workflow messages to the intended channel.

Slack documentation:

- [Create a workflow that starts outside Slack](https://slack.com/help/articles/360041352714-Build-a-workflow--Create-a-workflow-that-starts-outside-of-Slack)
- [Manage Workflow Builder access](https://slack.com/help/articles/360035822734-Manage-Workflow-Builder-access-and-features)

### Build the workflow

1. Open **Tools > Workflows**.
2. Select **New > Build Workflow**.
3. Under **Start the workflow**, select **Choose an event > From a webhook**.
4. Add one variable named exactly `message` with type **Text**.
5. Continue so Slack generates the private request URL. It begins with
   `https://hooks.slack.com/triggers/`.
6. Add the **Send a message to a channel** step.
7. Select the destination channel and insert the `message` variable as the
   message contents.
8. Give the workflow a recognizable name such as `qTest Pulse ChatOps`, add a
   second workflow manager where appropriate, finish, and publish it.
9. Copy the webhook request URL from the workflow's **From a webhook** trigger.

Keep the URL secret. Anyone who obtains it can start the workflow.

### Test Slack directly

Use PowerShell to verify the Slack workflow before configuring Pulse:

```powershell
$pulseSlackWebhook = "https://hooks.slack.com/triggers/replace/with/your-workflow-id"
$pulseSlackBody = @{ message = "qTest Pulse Slack workflow test" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $pulseSlackWebhook -ContentType "application/json" -Body $pulseSlackBody
```

The workflow should post the test message to its configured channel. Slack
limits webhook-triggered workflows to one request per second. The workflow
trigger supports up to 20 flat variables and does not support nested JSON;
this Action intentionally sends only `message`.

### Configure Pulse

1. Create or update the Slack Action from `chatops/SlackMessage.js`.
2. Create the Pulse constant `SlackWorkflowWebhook` and paste the generated
   Slack `/triggers/` URL as its value. `ChatOpsWebhook` remains a temporary
   constant-name alias, but its value must also be a Workflow Builder URL.
3. Ensure the Trigger is named exactly `ChatOpsEvent`.
4. Create a Rule connecting `ChatOpsEvent` to the Slack Action.
5. Leave the Microsoft Teams Rule connected to the same Trigger when parallel
   Slack and Teams notifications are desired.
6. Invoke `ChatOpsEvent` from a test Action with `{ "message": "Pulse test" }`
   and verify both child executions and both destination messages.

The Slack Action truncates messages to 4,000 characters by default and marks
the message when truncation occurs. Override the limit with
`SLACK_MESSAGE_MAX_CHARACTERS` (maximum 40,000). Configure
`SLACK_REQUEST_TIMEOUT_MS` when the default 15-second HTTP timeout is not
appropriate. The maximum is 45 seconds so the Action fails with a structured
timeout before Pulse's roughly one-minute external container limit.

## Microsoft Teams

`MSTeamsPowerAutomate.js` posts the same `event.message` contract to a Power
Automate workflow URL stored in the `TeamsWebhook` Pulse constant. Slack and
Teams remain separate provider Actions so credentials and transport details do
not leak into calling rules.

Use the Teams Workflows trigger **When a Teams webhook request is received** and
store its complete HTTPS callback URL in `TeamsWebhook`. The Action sends the
documented Adaptive Card envelope, including `contentUrl: null`, and accepts any
successful `2xx` trigger response. Microsoft documents this trigger and its
request schema in the
[Teams connector reference](https://learn.microsoft.com/en-us/connectors/teams/#when-a-teams-webhook-request-is-received).

Messages are truncated to 4,000 characters by default and marked when
truncation occurs. Override the limit with `TEAMS_MESSAGE_MAX_CHARACTERS`
(maximum 40,000). Configure `TEAMS_REQUEST_TIMEOUT_MS` when the default
15-second timeout is not appropriate; its maximum is 45 seconds.

The Action validates the neutral ChatOps payload and the HTTPS callback URL,
logs the correlation id and delivery status without exposing the signed
webhook, and throws structured HTTP, timeout, and transport failures. This
prevents Pulse from reporting a successful Teams rule when delivery actually
failed.

## Retired Slack attachment flow

The former `SlackAttachment.js` Action and `SlackAttachmentEvent` Trigger are
retired. The Action used Slack's discontinued `files.upload` API. Existing
external rules that still invoke `SlackAttachmentEvent` must be changed to
invoke `ChatOpsEvent` with a concise `message` before that Trigger is removed
from Pulse.
