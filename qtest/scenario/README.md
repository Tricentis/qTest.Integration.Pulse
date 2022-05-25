## qTest Workflow Integrations for the Scenario BDD plug-in for Jira

### UpdateQTestAndLinkScenarioRequirements.js
This action updates qTest Manager with results as well as chains together with linking the requirements to the scenarios in qTest.  Use this parser instead when leveraging the qTest Scenario plugin with the Cucumber framework.

### UpdateScenarioWithResults.js
This sets the line-by-line color coding in the qTest Scenario plugin for Jira for pass/fail/incomplete. 

### LinkScenarioRequirements.js
This is action code to link an existing qTest Test Case object, by object id, to a Jira requirement associated with a Scenario feature file. This assumes the Jira, qTest & Scenario integration is already set up and that Jira Issue already exists in qTest as a requirement. CreateTestCase.js uses this action/rule, but it could be used independetly. The payload expected is a json object outlining the test case objectid and the Jira requirement Issue Key.
