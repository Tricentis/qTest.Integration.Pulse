## Basic qTest Integrations

### UpdateQTestWithResults.js
This is the standard results delivery rule for use by ALL framework parsers in Pulse.  It uses the auto-test-logs endpoint to bulk upload test cases, test runs, and test logs to qTest Manager. In the qTest Scenario BDD workflow, it also attempts to tie requirements to test case if the names match.


## qTest Scenario Workflow Integrations

### UpdateQTestAndLinkScenarioRequirements.js
This action updates qTest Manager with results as well as chains together with linking the requirements to the scenarios in qTest.  Use this parser instead when leveraging the qTest Scenario plugin with the Cucumber framework.

### UpdateScenarioWithResults.js
This sets the line-by-line color coding in the qTest Scenario plugin for Jira for pass/fail/incomplete. 

### LinkScenarioRequirements.js
This is action code to link an existing qTest Test Case object, by object id, to a Jira requirement associated with a Scenario feature file. This assumes the Jira, qTest & Scenario integration is already set up and that Jira Issue already exists in qTest as a requirement. CreateTestCase.js uses this action/rule, but it could be used independetly. The payload expected is a json object outlining the test case objectid and the Jira requirement Issue Key.


## qTest and Jira Integrations

### CreateTestCase.js
This is action code to create a test case in qTest in the default API Creation qTest Test Design Module called 'Created via API'. The expected payload is the standard Jira webhook payload. This rule is used in conjunction with LinkRequirement.js and is intended to be used when a Jira Issue is created or modified to meet certain criteria (such as a status called Ready To Develop or something triggering wanting a default test case).

### LinkRequirement.js
This is action code to link an existing qTest Test Case object, by object id, to a Jira requirement by Jira Issue Key. This assumes the Jira & qTest integration is already set up and that Jira Issue already exists in qTest as a requirement. CreateTestCase.js uses this action/rule, but it could be used independetly. The payload expected is a json object outlining the test case objectid and the Jira requirement Issue Key.
