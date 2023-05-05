/**
 * call source: delivery script from CI Tool (Jenkins, Bamboo, TeamCity, CircleCI, etc), Launch, locally executed
 *              see 'delivery' subdirectory in this repository
 * payload example:
 * {
 *   properties: 'example value'
 *   arrayOfItems: [ { <properties and example values> } ]
 * }
 * constants:
 * - SCENARIO_PROJECT_ID: 84d46c6a-d39d-11e9-bb65-2a2ae2dbcce4
 * - QTEST_TOKEN: 84d46c6a-d39d-11e9-bb65-2a2ae2dbcce4
 * outputs:
 * - The unformatted items in the payload will be formatted into qTest test case
 * - The test cases then will be added to qTest project
 * - The unformatted result will be sent to the trigger "TriggerName"
 * - The ChatOps channel (if there is any) will notificate the result or error
 */

const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    // Payload to be passed in: json style cucumber for java test results

    /////// Pulse version
    var payload = body;
    var projectId = payload.projectId;
    var cycleId = payload.testcycle;

    let data = payload.result;
    let buffer = new Buffer(data, 'base64');
    let testResults = JSON.parse(buffer.toString('utf8'));

    var testLogs = [];
    console.log("TEST RESULTS: " + JSON.stringify(testResults));

    testResults.forEach(function (feature) {
        var featureName = feature.name;
        feature.elements.forEach(function (testCase) {

            if (!testCase.name)
                testCase.name = "Unnamed";

            TCStatus = "passed";

            var reportingLog = {
                exe_start_date: new Date(), // TODO These could be passed in
                exe_end_date: new Date(),
                module_names: [
                    featureName
                ],
                name: testCase.name,
                automation_content: feature.uri + "#" + testCase.name
            };

            var testStepLogs = [];
            order = 0;
            stepNames = [];
            attachments = [];

            testCase.steps.forEach(function (step) {
                // if the name is empty, as in the case of "Before" and "After" keywords, skip the step
                if(step.name !== "") { 
                    stepNames.push(step.name);

                    var status = step.result.status;
                    var actual = step.name;

                    if (TCStatus == "passed" && status == "skipped") {
                        TCStatus = "skipped";
                    }
                    if (status == "failed") {
                        TCStatus = "failed";
                        actual = step.result.error_message;
                    }
                    if (status == "undefined") {
                        TCStatus = "skipped";
                        status = "skipped";                    
                        emitEvent('ChatOpsEvent', { message: "Step result not found: " + step.name + "; marking as skipped." });
                    }

                    // Are there an attachment for this step?
                    if ("embeddings" in step) {
                        console.log("Has attachment");

                        attCount = 0;
                        step.embeddings.forEach(function (att) {
                            attCount++;
                            var attachment = {
                                name: step.name + " Attachment " + attCount,
                                "content_type": att.mime_type,
                                data: att.data
                            };
                            console.log("Attachment: " + attachment.name)

                            attachments.push(attachment);
                        });
                    }

                    var expected = step.keyword + " " + step.name;

                    if ("location" in step.match) {
                        expected = step.match.location;
                    }

                    var stepLog = {
                        order: order,
                        description: step.keyword + ' ' + step.name,
                        expected_result: step.name,
                        actual_result: actual,
                        status: status
                    };

                    testStepLogs.push(stepLog);
                }
                order++;
            });

            reportingLog.attachments = attachments;
            reportingLog.description = stepNames.join("<br/>");
            reportingLog.status = TCStatus;
            reportingLog.test_step_logs = testStepLogs;
            reportingLog.featureName = featureName;
            testLogs.push(reportingLog);
        });
    });

    var formattedResults = {
        "projectId": projectId,
        "testcycle": cycleId,
        "logs": testLogs
    };

    emitEvent('ChatOpsEvent', { message: "FormatJavaCucumber success" });
    emitEvent('UpdateQTestWithFormattedResults', formattedResults);

}
