const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    let payload = body;
    let projectId = payload.projectId;
    let cycleId = payload.testcycle;

    let testResults = JSON.parse(Buffer.from(payload.result, 'base64').toString('utf8'));

    let collectionName = testResults.collection.info.name;
    let testLogs = [];

    console.log(testResults.run.executions.length);

    testResults.run.executions.forEach(function (testCase) {
        let featureName = testCase.item.name;
        console.log('working test case: ' + featureName);

        let TCStatus = "passed";
        let reportingLog = {
            exe_start_date: new Date(),
            exe_end_date: new Date(),
            module_names: [
                collectionName,
                featureName
            ],
            name: testCase.item.name,
            automation_content: collectionName + "#" + testCase.item.name
        };

        let testStepLogs = [];
        let order = 0;

        if ("assertions" in testCase) {
            testCase.assertions.forEach(function (step) {
                let stepErrorVal = "passed";
                let actual = step.assertion;

                if ("error" in step) {
                    stepErrorVal = "failed";
                    TCStatus = "failed";
                    actual = step.error.message;
                }

                let stepLog = {
                    order: order,
                    description: step.assertion,
                    expected_result: step.assertion,
                    status: stepErrorVal,
                    actual_result: actual
                };

                testStepLogs.push(stepLog);
                order++;
            });
        } else {
            let stepInfo = `${testCase.request.method} ${testCase.request.url.protocol}://${testCase.request.url.host.join('.')} \r\n ${testCase.body}`;
            let stepLog = {
                order: order,
                description: stepInfo,
                expected_result: '200 OK',
                status: TCStatus,
                actual_result: testCase.response.code + ' ' + testCase.response.status
            };

            testStepLogs.push(stepLog);
            order++;
        }

        reportingLog.description = "Created by Pulse";
        reportingLog.status = TCStatus;
        reportingLog.test_step_logs = testStepLogs;
        reportingLog.featureName = featureName;
        testLogs.push(reportingLog);
        console.log(testLogs.length);
    });

    let formattedResults = {
        "projectId": projectId,
        "testcycle": cycleId,
        "logs": testLogs
    };

    emitEvent('UpdateQTestWithFormattedResults', formattedResults);
}
