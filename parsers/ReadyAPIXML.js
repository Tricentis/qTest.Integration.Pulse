const PulseSdk = require("@qasymphony/pulse-sdk");
const request = require("request");
const xml2js = require("xml2js");
const { Webhooks } = require("@qasymphony/pulse-sdk");

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

    let parseString = require("xml2js").parseString;
    let startTime = "";
    let endTime = "";
    let lastEndTime = 0;

    parseString(
        testResults,
        {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false,
        },
        function (err, result) {
            if (err) {
                emitEvent("ChatOpsEvent", { message: "Unexpected Error Parsing XML Document: " + err });
                console.log("[ERROR]: " + err);
            } else {
                let classStatus = "";
                let testsuites = Array.isArray(result.testSuiteResults["testSuite"])
                    ? result.testSuiteResults["testSuite"]
                    : [result.testSuiteResults["testSuite"]];
                testsuites.forEach(function (testsuite) {
                    lastEndTime = 0;
                    let suiteName = testsuite.testSuiteName;
                    console.log("[INFO]: Suite Name: " + suiteName);
                    let testcases = Array.isArray(testsuite.testRunnerResults["testCase"])
                        ? testsuite.testRunnerResults["testCase"]
                        : [testsuite.testRunnerResults["testCase"]];
                    testcases.forEach(function (testcase) {
                        className = testcase.testCaseName;
                        console.log("[INFO]: Class Name: " + className);
                        classId = testcase.testCaseId;
                        let moduleNames = [suiteName];
                        let stack = "";

                        console.log("[INFO]: Class Status: " + testcase.status);

                        if (testcase.status == "OK" || testcase.status == "PASS" || testcase.status == "FINISHED") {
                            classStatus = "PASSED";
                        } else if (testcase.status == "FAIL") {
                            classStatus = "FAILED";
                        } else if (testcase.status == "UNKNOWN") {
                            classStatus = "SKIPPED";
                        }
                        console.log("[INFO]: Translated Status: " + classStatus);

                        let teststeps = Array.isArray(testcase.testStepResults["result"])
                            ? testcase.testStepResults["result"]
                            : [testcase.testStepResults["result"]];
                        let teststepparams = Array.isArray(testcase.testStepParameters["parameters"])
                            ? testcase.testStepParameters["parameters"]
                            : [testcase.testStepParameters["parameters"]];
                        let testStepLogs = [];
                        teststeps.forEach(function (teststep) {
                            let stepStatus = "";

                            teststepparams.forEach(function (teststepparam) {
                                if (teststepparam.testStepName == teststep.name) {
                                    testStepParam = teststepparam.iconPath;
                                }
                            });

                            if (lastEndTime == 0) {
                                startTime = new Date();
                            } else {
                                startTime = lastEndTime;
                            }
                            interim =
                                new Date(Date.parse(startTime)).getSeconds() + parseFloat(teststep.timeTaken / 1000);
                            endTime = new Date(Date.parse(startTime)).setSeconds(interim);
                            endTime = new Date(endTime).toISOString();

                            if (teststep.status == "OK" || teststep.status == "PASS" || teststep.status == "FINISHED") {
                                stepStatus = "PASSED";
                            } else if (teststep.status == "FAIL") {
                                stepStatus = "FAILED";
                            } else if (teststep.status == "UNKNOWN") {
                                stepStatus = "SKIPPED";
                            }

                            if (stepStatus == "FAILED") {
                                let testFailure = Array.isArray(testcase.failedTestSteps["error"])
                                    ? testcase.failedTestSteps["error"]
                                    : [testcase.failedTestSteps["error"]];
                                testFailure.forEach(function (failure) {
                                    if (failure !== undefined) {
                                        if (failure.testStepName == teststep.name) {
                                            stack = failure.detail;
                                        }
                                    }
                                });
                            }

                            let testStepLog = {
                                order: teststep.order - 1,
                                description: teststep.name,
                                expected_result: testStepParam,
                                actual_result: teststep.message,
                                status: stepStatus,
                                attachments: [],
                            };

                            if (stack !== "") {
                                testStepLog.attachments.push({
                                    name: `${className}.txt`,
                                    data: Buffer.from(stack).toString("base64"),
                                    content_type: "text/plain",
                                });
                            }

                            testStepLogs.push(testStepLog);
                        });

                        let note = "";

                        let testLog = {
                            status: classStatus,
                            name: className,
                            attachments: [],
                            note: note,
                            exe_start_date: startTime,
                            exe_end_date: endTime,
                            automation_content: htmlEntities(className),
                            module_names: moduleNames,
                            test_step_logs: testStepLogs,
                        };

                        //testLog.attachments.push(payload.consoleOutput[0]);
                        testLogs.push(testLog);
                        lastEndTime = endTime;
                    });
                });
            }
        }
    );

    let formattedResults = {
        projectId: projectId,
        testcycle: cycleId,
        logs: testLogs,
    };

    emitEvent("ChatOpsEvent", { message: "Results formatted successfully for ReadyAPI." });
    console.log("[INFO]: Results formatted successfully for ReadyAPI.");
    emitEvent("UpdateQTestWithFormattedResults", formattedResults);
};
