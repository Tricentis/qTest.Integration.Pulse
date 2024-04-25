const { Webhooks } = require('@qasymphony/pulse-sdk');

/*
 * call source: delivery script from CI Tool (Jenkins, Bamboo, TeamCity, CircleCI, etc), Launch, locally executed
 *              see 'delivery' subdirectory in this repository
 * payload example, Base64encoded:
 * {
 *   "projectId": "5",
 *   "testcycle": "555555",
 *   "result": {
 *     "results": [
 *       {
 *         "suites": [
 *           {
 *             "tests": [
 *               {
 *                 "state": "passed",
 *                 "title": "Test 1 Name",
 *                 "uuid": "unique id"
 *               }
 *             ],
 *             "title": "Suite 1 Title"
 *           }
 *         ]
 *       }
 *     ],
 *     "stats": {
 *       "start": "start date",
 *       "end": "end date"
 *     }
 *   }
 * }
 * constants:
 * - QTEST_TOKEN: the qTest user bearer token from the API/SDK section of the 'Resources' area
 * outputs:
 * - Results formatted into qTest test case format and added to the qTest project
 * - Formatted result sent to the trigger "UpdateQTestWithResults"
 * - ChatOpsEvent channel (if any) notified of the result or error
 */
exports.handler = async function({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    try {
        let payload = body;
        let projectId = payload.projectId;
        let cycleId = payload.testcycle;

        let testResults = JSON.parse(Buffer.from(payload.result, 'base64').toString('utf8'));

        let testLogs = [];

        for (let result of testResults.results) {
            for (let suite of result.suites) {
                for (let test of suite.tests) {
                    let reportingLog = {
                        status: test.state,
                        exe_start_date: testResults.stats.start,
                        exe_end_date: testResults.stats.end,
                        module_names: [suite.title],
                        name: test.title,
                        automation_content: test.uuid,
                        properties: [],
                        note: test.state == 'failed' ? test.err.estack : ''
                    };

                    let testStepLogs = [{
                        order: 1,
                        description: test.title,
                        expected_result: test.title,
                        actual_result: test.title,
                        status: test.state
                    }];

                    reportingLog.description = test.code.replace('\\n', '<br />');
                    reportingLog.test_step_logs = testStepLogs;
                    reportingLog.featureName = suite.title + '.feature';
                    testLogs.push(reportingLog);
                }
            }
        }

        let formattedResults = {
            "projectId": projectId,
            "testcycle": cycleId,
            "logs": testLogs
        };

        console.log('[INFO]: Cypress test successfully parsed.');
        emitEvent('UpdateQTestWithResults', formattedResults);
    } catch (error) {
        emitEvent('ChatOpsEvent', { message: 'Error processing Cypress test results: ' + error });
        console.error(`[ERROR]: Error processing Cypress test results: ${error}`);
    }
};
