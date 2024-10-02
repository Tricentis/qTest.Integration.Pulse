import xml2js from "xml2js";
import { Webhooks } from "@qasymphony/pulse-sdk";

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find((t) => t.name === name);
        return t
            ? new Webhooks().invoke(t, payload)
            : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    let payload = body;
    let projectId = payload.projectId;
    let cycleId = payload.testcycle;
    let testLogs = [];

    let testResults = Buffer.from(payload.result, "base64").toString("utf8");
    let suiteName = "";
    let testSteps = [];
    let startTime = "";
    let endTime = "";
    let lastEndTime = 0;

    xml2js.parseString(
        testResults,
        {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false,
        },
        function (err, result) {
            if (err) {
                emitEvent("ChatOpsEvent", { Error: "Unexpected Error Parsing XML Document: " + err });
                console.log(err);
            } else {
                let testsuites = Array.isArray(result.testsuites["testsuite"])
                    ? result.testsuites["testsuite"]
                    : [result.testsuites["testsuite"]];
                testsuites.forEach(function (testsuite) {
                    lastEndTime = 0;
                    suiteName = testsuite.$.name;
                    console.log("Suite Name: " + suiteName);
                    let testcases = Array.isArray(testsuite.testcase) ? testsuite.testcase : [testsuite.testcase];
                    testcases.forEach(function (testcase) {
                        let className = testcase.$.name;
                        console.log("Class Name: " + className);
                        let moduleNames = [suiteName];
                        let classStatus = "passed";
                        if (lastEndTime == 0) {
                            startTime = new Date(Date.parse(testsuite.$.timestamp)).toISOString();
                        } else {
                            startTime = lastEndTime;
                        }
                        let interim = new Date(Date.parse(startTime)).getSeconds() + parseFloat(testcase.$.time);
                        endTime = new Date(Date.parse(startTime)).setSeconds(interim);
                        endTime = new Date(endTime).toISOString();

                        let stepArray = testcase.$.log.split("\r\n");
                        let stepOrder = 1;
                        testSteps = [];

                        stepArray.forEach(function (step, i) {
                            let testStep = "";
                            if (i == 0) {
                                console.log("First line is the test case name, skipping");
                            } else if (step.trim() == "") {
                                console.log("Blank line, skipping");
                            } else if (step.trim().startsWith("+ Passed")) {
                                console.log("Step is a pass");
                                testStep = {
                                    description: step.replace("+ Passed", "").trim(),
                                    expected_result: step.replace("+ Passed", "").trim(),
                                    actual_result: step.replace("+ Passed", "").trim(),
                                    order: stepOrder,
                                    status: "PASSED",
                                };
                                testSteps.push(testStep);
                                stepOrder++;
                            } else if (step.trim().startsWith("- Failed")) {
                                console.log("Step is a failure");
                                testStep = {
                                    description: step.replace("- Failed", "").trim(),
                                    expected_result: step.replace("- Failed", "").trim(),
                                    actual_result: step.replace("- Failed", "").trim(),
                                    order: stepOrder,
                                    status: "FAILED",
                                };
                                testSteps.push(testStep);
                                stepOrder++;
                            } else if (step.trim().startsWith("Error")) {
                                console.log("Step is an error");
                                testStep = {
                                    description: step.replace("Error", "").trim(),
                                    expected_result: step.replace("-Error", "").trim(),
                                    actual_result: step.replace("Error", "").trim(),
                                    order: stepOrder,
                                    status: "FAILED",
                                };
                                testSteps.push(testStep);
                                stepOrder++;
                            } else {
                                console.log("Step is part of last step, appending");
                                testSteps[testSteps.length - 1].description = testSteps[
                                    testSteps.length - 1
                                ].description.concat("\n", step.trim());
                                testSteps[testSteps.length - 1].expected_result = testSteps[
                                    testSteps.length - 1
                                ].expected_result.concat("\n", step.trim());
                                testSteps[testSteps.length - 1].actual_result = testSteps[
                                    testSteps.length - 1
                                ].actual_result.concat("\n", step.trim());
                            }
                        });

                        testSteps.forEach(function (step, i) {
                            testSteps[i].description = step.description.replace(/({[^}]+})/g, "");
                            testSteps[i].expected_result = step.expected_result.replace(/({[^}]+})/g, "");
                        });

                        let note = "";
                        let stack = "";
                        let testFailure = Array.isArray(testcase.failure) ? testcase.failure : [testcase.failure];
                        testFailure.forEach(function (failure) {
                            if (failure !== undefined) {
                                note = failure.$.message;
                                stack = failure.$.message;
                                classStatus = "failed";
                            }
                        });
                        console.log(classStatus);

                        let testLog = {
                            status: classStatus,
                            name: className,
                            attachments: [],
                            test_step_logs: testSteps,
                            note: note,
                            exe_start_date: startTime,
                            exe_end_date: endTime,
                            automation_content: className,
                            module_names: moduleNames,
                        };
                        if (stack !== "") {
                            testLog.attachments.push({
                                name: `${className}.txt`,
                                data: Buffer.from(stack).toString("base64"),
                                content_type: "text/plain",
                            });
                        }
                        testLogs.push(testLog);
                        lastEndTime = endTime;
                    }); // end
                });
            }
        }
    );

    let formattedResults = {
        projectId: projectId,
        testcycle: cycleId,
        logs: testLogs,
    };

    emitEvent("ChatOpsEvent", { message: "Results formatted successfully for Tosca Execution List: " + suiteName });
    emitEvent("UpdateQTestWithFormattedResults", formattedResults);
    console.log("works");
};

function htmlEntities(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
