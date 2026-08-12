# qTest and Jira Helpers

These legacy reference Actions create a minimal qTest Test Case from a Jira
issue webhook and link it to an existing Jira-backed qTest Requirement. They
assume the standard Jira/qTest integration has already synchronized the issue
as a qTest Requirement whose name contains the Jira issue key.

They have not received the validation, correlation logging, structured error
handling, or async-completion modernization applied to the standard results
pipeline. Review and test them before production deployment.

## Pulse objects

| Action | Input | Constants | Downstream Triggers |
| --- | --- | --- | --- |
| `CreateTestCaseFromJira.js` | Jira webhook JSON containing `issue.key` | `QTEST_TOKEN`, `ManagerURL`, `ProjectID` | `LinkRequirement` required; `ChatOpsEvent` optional |
| `LinkRequirement.js` | `{ "tcid": 12345, "issueKey": "PROJECT-123" }` | `QTEST_TOKEN`, `ManagerURL`, `ProjectID` | `ChatOpsEvent` optional |

Create a Rule from the filtered Jira webhook Trigger to
`CreateTestCaseFromJira.js`. Create a second Trigger named exactly
`LinkRequirement` and connect it to `LinkRequirement.js`.

`CreateTestCaseFromJira.js` creates a Test Case named `TC for Req <issueKey>` in
the qTest API's default creation location, then emits its object id.
`LinkRequirement.js` searches qTest Requirements by Jira key and links the first
match to that Test Case.

## Limitations

- The current implementation does not validate duplicate Test Cases.
- Requirement search assumes the Jira issue already exists in qTest and uses
  the first match.
- Project/module placement, naming, Jira event filtering, and permissions are
  environment-specific.
- The current callback-based implementation needs modernization before it can
  provide reliable Pulse completion status for every child call.

See the [qTest API documentation](https://qtest.dev.tricentis.com/) for Test
Case, search, Requirement-link, and authentication contracts.
