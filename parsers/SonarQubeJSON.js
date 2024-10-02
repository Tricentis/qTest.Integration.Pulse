import { Webhooks } from "@qasymphony/pulse-sdk";

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find((t) => t.name === name);
        return t
            ? new Webhooks().invoke(t, payload)
            : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    // Payload to be passed in: json results from SonarQube webhook integration

    let payload = body;
    let projectId = payload.projectId;
    let cycleId = payload.testcycle;

    let testResults = JSON.parse(payload.result);

    let testLogs = [];

    let moduleName = testResults.project.name;

    console.log(moduleName);

    testResults.qualityGate.conditions.forEach(function (condition) {
        let tcsStatus = "PASS"; // NOTE: that the automation settings must be mapped with passed vs the default PASS
        let reportingLog = {
            exe_start_date: testResults.analysedAt,
            exe_end_date: testResults.changedAt,
            module_names: [moduleName],
            name: condition.metric,
            automation_content: testResults.taskId + "#" + moduleName + "#" + condition.metric,
            properties: [],
        };

        let testStepLogs = [];

        let operator = "";
        if (condition.operator == "LESS_THAN") {
            operator = " > ";
        }
        if (condition.operator == "GREATER_THAN") {
            operator = " < ";
        }

        let description = condition.metric;
        let expected = operator + condition.errorThreshold;
        let actual = condition.value;
        let status = condition.status;

        if (status == "ERROR") {
            tcsStatus = "FAIL";
            status = "FAIL";
        }
        if (status == "OK") {
            tcsStatus = "PASS";
            status = "PASS";
        }

        let stepLog = {
            order: 1,
            description: description,
            expected_result: expected,
            actual_result: actual,
            status: status,
        };

        testStepLogs.push(stepLog);

        reportingLog.description = testResults.project.name;
        reportingLog.status = tcsStatus;
        reportingLog.test_step_logs = testStepLogs;
        reportingLog.featureName = condition.metric;
        testLogs.push(reportingLog);
    });

    let formattedResults = {
        projectId: projectId,
        testcycle: cycleId,
        logs: testLogs,
    };

    emitEvent("UpdateQTestWithFormattedResults", formattedResults);
    console.log("JSON parsed successfully");
};
