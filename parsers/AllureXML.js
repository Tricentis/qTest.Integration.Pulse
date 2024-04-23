const xml2js = require('xml2js');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        return (t = triggers.find(t => t.name === name)) ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    let { projectId, testcycle, result } = body;
    let testLogs = [];

    let testResults = Buffer.from(result, 'base64').toString('utf8');

    xml2js.parseString(testResults, {
        preserveChildrenOrder: true,
        explicitArray: false,
        explicitChildren: false
    }, function (err, result) {
        if (err) {
            console.error('[ERROR]: Unexpected Error Parsing XML Document: ' + err);
            return;
        }

        let testSuiteName = result['ns2:test-suite'].name.trim();
        let testCases = Array.isArray(result['ns2:test-suite']['test-cases']['test-case']) ? result['ns2:test-suite']['test-cases']['test-case'] : [result['ns2:test-suite']['test-cases']['test-case']];

        testCases.forEach(function (testCase) {
            let testSteps = [];
            let { name: testCaseName, $: { start: testCaseStartDate, end: testCaseEndDate, status: testCaseStatus }, steps } = testCase;
            console.log('[INFO]: Test Case: ' + testCaseName);
            console.log('[INFO]: Test Case Status: ' + testCaseStatus);

            let testCaseSteps = steps && steps.step ? (Array.isArray(steps.step) ? steps.step : [steps.step]) : [];
            let stepNumber = 1;

            testCaseSteps.forEach(function (testStep) {
                console.log('[INFO]: Test Step ' + stepNumber + ': ' + testStep.name);
                let testStepObj = {
                    "description": testStep.name,
                    "expected_result": testStep.name,
                    "actual_result": testStep.name,
                    "order": stepNumber,
                    "status": testStep.$.status
                };

                testSteps.push(testStepObj);
                stepNumber++;
            });

            let testLog = {
                status: testCaseStatus,
                name: testCaseName,
                attachments: [],
                exe_start_date: new Date(parseInt(testCaseStartDate)).toISOString(),
                exe_end_date: new Date(parseInt(testCaseEndDate)).toISOString(),
                automation_content: testCaseName,
                module_names: [testSuiteName],
                test_step_logs: testSteps
            };

            testLogs.push(testLog);
        });

        let formattedResults = {
            "projectId": projectId,
            "testcycle": testcycle,
            "logs": testLogs
        };

        emitEvent('UpdateQTestWithFormattedResults', formattedResults);
        console.log('[INFO]: Results shipped to qTest.');
    });
};