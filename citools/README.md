# CI Pipeline Trigger Actions

These standalone Pulse Actions dispatch work to nine CI providers. Connect the
Action to the repository, approval, Scenario, or other Trigger that should start
the build. Add the optional `ChatOpsEvent` Trigger to the same Action when
Slack and/or Teams notifications are desired.

## Shared contract

All Actions accept an optional `event.correlationId`. When it is absent, the
Action generates one. Provider-specific refs and parameters are accepted in the
event payload and documented below.

Every Action:

- validates required constants before making a provider request;
- uses Axios with a 15-second timeout, configurable through the optional
  `CI_REQUEST_TIMEOUT_MS` constant and capped at 45 seconds;
- accepts every `2xx` provider response as an accepted dispatch;
- returns the correlation id, provider, pipeline identity, HTTP status, and any
  run/build id and URL returned immediately by the provider;
- logs sanitized configuration, dispatch, and optional ChatOps stages;
- throws validation, timeout, transport, and HTTP failures after attempting an
  optional failure notification;
- never automatically retries a dispatch because an ambiguous response may
  already have created a build; and
- emits optional ChatOps payloads with `correlationId`, `message`, and:

```json
{
  "source": {
    "type": "ci-trigger",
    "provider": "github-actions",
    "pipeline": "owner/repository:workflow.yml",
    "runId": "optional-provider-run-id"
  }
}
```

Missing or failed `ChatOpsEvent` delivery is logged but does not replace the
primary CI dispatch outcome. Every returned Pulse child execution id is logged.

## Provider setup

| Action | Required constants | Event overrides / inputs |
| --- | --- | --- |
| `TriggerBamboo.js` | `BambooUserName`, `BambooPassword`, `BambooURL`, `BambooProjectCode` | `correlationId` |
| `TriggerJenkins.js` | `JenkinsUserName`, `JenkinsAPIToken`, `JenkinsURL`, `JenkinsJobName`, `JenkinsJobToken`; `JenkinsParamJob` is a compatibility alias for the job name | No parameters selects `/build`; `parameters` selects `/buildWithParameters`; legacy `tag` maps to `Tag` |
| `TriggerTeamCity.js` | `TeamCityUserName`, `TeamCityPassword`, `TeamCityURL`, `TeamCityBuildCode` | `correlationId`; legacy `TeamCityPort` remains supported |
| `TriggerGitHubActions.js` | `GitHubOwner`, `GitHubRepository`, `GitHubWorkflow`, `GitHubToken`; `GitHubRef` unless `event.ref` is provided | `ref`, `inputs` |
| `TriggerGitLabPipeline.js` | `GitLabProjectId`, `GitLabTriggerToken`; `GitLabRef` unless `event.ref` is provided | `ref`, `variables`, `inputs`; optional `GitLabURL` defaults to `https://gitlab.com` |
| `TriggerAzurePipeline.js` | `AzureDevOpsOrganization`, `AzureDevOpsProject`, `AzureDevOpsPipelineId`, `AzureDevOpsToken` | `ref`, `variables`, `templateParameters`, `resources`, `stagesToSkip`; `AZDO_TOKEN` is a compatibility alias |
| `TriggerCircleCIPipeline.js` | `CircleCIProvider`, `CircleCIOrganization`, `CircleCIProject`, `CircleCIPipelineDefinitionId`, `CircleCIToken`; `CircleCIBranch` unless an event ref is supplied | exactly one of `branch` or `tag`; optional `configBranch`, `parameters` |
| `TriggerBitbucketPipeline.js` | `BitbucketWorkspace`, `BitbucketRepository`, `BitbucketToken`; `BitbucketBranch` unless `event.ref` is provided | `ref`, `refType`, `commit`, custom `selector`, `variables`; optional `BitbucketUserName` selects Basic API-token authentication |
| `TriggerBuildkiteBuild.js` | `BuildkiteOrganization`, `BuildkitePipeline`, `BuildkiteToken`; `BuildkiteBranch` unless `event.branch` is provided | `branch`, `commit`, `message`, `env`, `metaData`, `author`, `cleanCheckout` |

For Bamboo, Jenkins, GitLab Self-Managed, and TeamCity, a URL constant may be a
complete HTTP(S) base URL. Existing host-only values retain their historical
HTTP behavior and produce a warning. Prefer a complete HTTPS URL. Credentials
are sent through Axios authentication or headers and are never embedded in the
request URL.

The former `TriggerJenkinsWithParams.js` Action is retired. Replace its source
with `TriggerJenkins.js`; existing `JenkinsParamJob` and `event.tag` values
continue to work. New configurations should use `JenkinsJobName` and
`event.parameters`.

## Provider-specific notes

### Bamboo

`BambooProjectCode` is the complete plan key placed after
`/rest/api/latest/queue/`, normally in `PROJECT-PLAN` form. `BambooURL` should
include any Bamboo context path. The Action uses HTTP Basic authentication with
the configured username and password. Confirm the queue resource and
authentication model for the deployed Bamboo Data Center version in the
[Bamboo REST API reference](https://developer.atlassian.com/server/bamboo/rest/api-group-api/).

### Jenkins

`JenkinsJobName` may include a folder path; the Action encodes each path
segment as `/job/<segment>`. With no parameters it posts to `/build`.
`event.parameters` selects `/buildWithParameters`; the legacy `event.tag`
becomes the `Tag` parameter. The Action obtains the controller's crumb header
before dispatch and uses username/API-token Basic authentication. See the
[Jenkins Remote Access API](https://www.jenkins.io/doc/book/using/remote-access-api/).

### TeamCity

`TeamCityBuildCode` is the build configuration id (`buildType.id`), not its
display name. The Action posts the XML `Build` entity to
`/httpAuth/app/rest/buildQueue` and requests a JSON response. Confirm the user
can run the build configuration. See the
[TeamCity start-build documentation](https://www.jetbrains.com/help/teamcity/rest/start-and-cancel-builds.html).

### GitHub Actions

The target workflow must declare `workflow_dispatch`. `GitHubWorkflow` can be
the workflow numeric id or file name. A fine-grained token needs repository
Actions write permission. See the
[workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

### GitLab CI/CD

Create a pipeline trigger token under the project's CI/CD settings. The Action
uses `POST /projects/:id/trigger/pipeline` and supports GitLab variables and
typed pipeline inputs. See the
[pipeline trigger token API](https://docs.gitlab.com/api/pipeline_triggers/).

### Azure Pipelines

The token needs permission to execute builds. Scalar `event.variables` values
are converted to `{ "value": "..." }`; existing Azure variable objects are
preserved. A short ref such as `main` becomes `refs/heads/main`. See the
[Run Pipeline API v7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/pipelines/runs/run-pipeline?view=azure-devops-rest-7.1).

### CircleCI

This Action uses the current pipeline-definition endpoint
`/api/v2/project/{provider}/{organization}/{project}/pipeline/run`, not the
superseded project pipeline endpoint. Tag dispatches may use `configBranch` to
identify the branch containing CircleCI configuration. See the
[CircleCI API v2 reference](https://circleci.com/docs/api/v2/).

### Bitbucket Pipelines

An OAuth access token can be sent as Bearer authentication. For an Atlassian
account API token, also configure `BitbucketUserName` with the account email so
the Action uses Basic authentication. The credential needs pipeline read/write
permission. `variables` is an object; use
`{ "value": "...", "secured": true }` for a secured variable. See the
[Bitbucket Pipelines API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pipelines/#api-repositories-workspace-repo-slug-pipelines-post).

### Buildkite

The token needs `write_builds`. `commit` defaults to `HEAD`; a branch is always
required. See the
[Buildkite Create a build API](https://buildkite.com/docs/apis/rest-api/builds#create-a-build).

## Verification

Start with a non-production pipeline and a unique `correlationId`. Confirm:

1. the provider creates exactly one run;
2. the CI Action returns or logs the provider run/build id when available;
3. each configured ChatOps rule logs its Pulse child execution id;
4. Slack and Teams show the same correlation id and provider source; and
5. invalid credentials fail the CI Action without exposing the credential in
   the Pulse execution logs.
