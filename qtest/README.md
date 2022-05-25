## Basic qTest Integrations

### UpdateQTestWithResults.js
This is the standard results delivery rule for use by ALL OOTB framework parsers in Pulse.  It uses the auto-test-logs endpoint to bulk upload test cases, test runs, and test logs to qTest Manager. In the qTest Scenario BDD workflow, it also attempts to tie requirements to test case if the names match.


## Advanced qTest Integrations

### azure-devops
This is the product-supported out-of-the-box integration for Azure DevOps Boards, supporting a limited two-way integration for Requirements and a one-way integration for Defects.

### jira
These are basic workflows for Jira Requirements to auto-create Test Cases in qTest Manager and auto-associate them with the new Jira Requirements.

### scenario
These are the advanced workflows to be used with the Scenario BDD plug-in for Jira.  Please see our [official documentation](https://documentation.tricentis.com/qtest/od/en/content/pulse/qtest_pulse_quick_start_guide.htm#qTestPulseQuickStartGuide) for instructions on configuring this workflow.