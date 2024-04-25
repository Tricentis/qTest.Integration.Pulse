
const { Webhooks } = require('@qasymphony/pulse-sdk');

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
 * - The formatted result will be sent to the trigger "TriggerName"
 * - The ChatOps channel (if there is any) will notify the result or error
 */

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    try {
        let payload = body;
        let projectId = payload.projectId;
        let cycleId = payload.testcycle;

        let data = Buffer.from(payload.result, 'base64').toString('utf8');
        let testResults = JSON.parse(data);

        let testLogs = [];

        testResults.forEach(function (feature) {
            let featureName = feature.name;
            feature.elements.forEach(function (testCase) {
                if (!testCase.name)
                    testCase.name = "Unnamed";

                let TCStatus = "passed";

                let reportingLog = {
                    exe_start_date: new Date(),
                    exe_end_date: new Date(),
                    module_names: [featureName],
                    name: testCase.name,
                    automation_content: feature.uri + "#" + testCase.name
                };

                let testStepLogs = [];
                let order = 0;
                let stepNames = [];
                let attachments = [];

                testCase.steps.forEach(function (step) {
                    if (step.name !== "") {
                        stepNames.push(step.name);

                        let status = step.result.status;
                        let actual = step.name;

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
                            emitEvent('ChatOpsEvent', { message: '[INFO]: Cucumber Parser - Step result not found: ' + step.name + '; marking as skipped.' });
                            console.log(`[INFO]: Cucumber Parser - Step result not found: ${step.name}; marking as skipped.`);
                        }

                        if ("embeddings" in step) {
                            console.log('[INFO]: "Step has screenshot attachment, adding...');

                            let attCount = 0;
                            step.embeddings.forEach(function (att) {
                                attCount++;
                                let attachment = {
                                    name: step.name + " Attachment " + attCount,
                                    "content_type": att.mime_type,
                                    data: att.data
                                };
                                console.log("Attachment: " + attachment.name);

                                attachments.push(attachment);
                            });
                        }

                        let expected = step.keyword + " " + step.name;

                        if ("location" in step.match) {
                            expected = step.match.location;
                        }

                        let stepLog = {
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

        let formattedResults = {
            "projectId": projectId,
            "testcycle": cycleId,
            "logs": testLogs
        };

        emitEvent('ChatOpsEvent', { message: '[INFO]: Cucumber results successfully parsed.' });
        console.log('[INFO]: Cucumber results successfully parsed.');
        emitEvent('UpdateQTestWithResults', formattedResults);
    } catch (error) {
        emitEvent('ChatOpsEvent', { message: '[ERROR]: Error processing Java Cucumber results: ' + error });
        console.error(`[ERROR]: Error processing Java Cucumber results: ${error}`);
    }
};