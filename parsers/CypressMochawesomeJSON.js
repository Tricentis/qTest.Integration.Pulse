const PulseSdk = require('@qasymphony/pulse-sdk');
const { Webhooks } = require('@qasymphony/pulse-sdk');

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function({
    event: body,
    constants,
    triggers
}, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }
    var payload = body;
    var projectId = payload.projectId;
    var cycleId = payload.testcycle;

    let testResults = JSON.parse(Buffer.from(payload.result, 'base64').toString('utf8'));

    var testLogs = [];

    for (let r = 0, rlen = testResults.results.length; r < rlen; r++) {
        let currentResult = testResults.results[r];
        for (let s = 0, slen = currentResult.suites.length; s < slen; s++) {
            let currentSuite = currentResult.suites[s];
            for (let t = 0, tlen = currentSuite.tests.length; t < tlen; t++) {
                let currentTest = currentSuite.tests[t];
                var reportingLog = {
                    status: currentTest.state,
                    exe_start_date: testResults.stats.start,
                    exe_end_date: testResults.stats.end,
                    module_names: [
                        currentSuite.title
                    ],
                    name: currentTest.title,
                    automation_content: currentTest.uuid,
                    properties: [],
                    note: currentTest.state == 'failed' ? currentTest.err.estack : ''
                };

                var testStepLogs = [];

                var stepLog = {
                    order: 1,
                    description: currentTest.title,
                    expected_result: currentTest.title,
                    actual_result: currentTest.title,
                    status: currentTest.state
                };

                testStepLogs.push(stepLog);

                reportingLog.description = currentTest.code.replace('\\n', '<br />');
                reportingLog.test_step_logs = testStepLogs;
                reportingLog.featureName = currentSuite.title + '.feature';
                testLogs.push(reportingLog);
            }
        }
    }

    var formattedResults = {
        "projectId": projectId,
        "testcycle": cycleId,
        "logs": testLogs
    };

    emitEvent('UpdateQTestWithFormattedResults', formattedResults);
}