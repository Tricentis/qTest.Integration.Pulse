## qTest and Jira Integrations

### CreateTestCaseFromJira.js
This is action code to create a test case in qTest in the default API Creation qTest Test Design Module called 'Created via API'. The expected payload is the standard Jira webhook payload. This rule is used in conjunction with LinkRequirement.js and is intended to be used when a Jira Issue is created or modified to meet certain criteria (such as a status called Ready To Develop or something triggering wanting a default test case).

### LinkRequirement.js
This is action code to link an existing qTest Test Case object, by object id, to a Jira requirement by Jira Issue Key. This assumes the Jira & qTest integration is already set up and that Jira Issue already exists in qTest as a requirement. CreateTestCase.js uses this action/rule, but it could be used independetly. The payload expected is a json object outlining the test case objectid and the Jira requirement Issue Key.
