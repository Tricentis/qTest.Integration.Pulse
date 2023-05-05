const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    var payload = body;
    var projectId = payload.projectId;
    var cycleId = payload.testcycle;

    let testResults = JSON.parse(Buffer.from(payload.result, 'base64').toString('utf8'));

    var collectionName = testResults.collection.info.name;
    var testLogs = [];
    console.log(testResults.run.executions.length);

    testResults.run.executions.forEach(function (testCase) {

        var featureName = testCase.item.name;
        console.log('working test case: ' + featureName);

        TCStatus = "passed";
        var reportingLog = {
            exe_start_date: new Date(), // TODO These could be passed in
            exe_end_date: new Date(),
            module_names: [
                collectionName,
                featureName
            ],
            name: testCase.item.name,
            automation_content: collectionName + "#" + testCase.item.name // TODO See if ID is static or when that changes
        };

        var testStepLogs = [];
        order = 0;
        stepNames = [];


        if ("assertions" in testCase) {
            testCase.assertions.forEach(function (step) {
                stepNames.push(step.assertion);
                stepErrorVal = "passed";

                var actual = step.assertion;

                if ("error" in step) {
                    stepErrorVal = "failed";
                    TCStatus = "failed";
                    actual = step.error.message;
                }

                var stepLog = {
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
            var stepInfo = testCase.request.method + ' ' + testCase.request.url.protocol + '://' + testCase.request.url.host.join('.') + '\r\n' + testCase.body;
            var stepLog = {
                order: order,
                description: stepInfo,
                expected_result: '200 OK',
                status: TCStatus,
                actual_result: testCase.response.code + ' ' + testCase.response.status
            };

            testStepLogs.push(stepLog);
            order++;
        };

        reportingLog.description = "Created by Pulse"; // testCase.request;
        reportingLog.status = TCStatus;
        reportingLog.test_step_logs = testStepLogs;
        reportingLog.featureName = featureName;
        testLogs.push(reportingLog);
        console.log(testLogs.length);

    });

    var formattedResults = {
        "projectId": projectId,
        "testcycle": cycleId,
        "logs": testLogs
    };

    emitEvent('UpdateQTestWithFormattedResults', formattedResults);
}
