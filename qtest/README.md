## Basic qTest Integrations

### UpdateQTestWithResults.js
This is the standard results delivery rule for use by ALL OOTB framework parsers in Pulse.  It uses the auto-test-logs endpoint to bulk upload test cases, test runs, and test logs to qTest Manager. In the qTest Scenario BDD workflow, it also attempts to tie requirements to test case if the names match.
