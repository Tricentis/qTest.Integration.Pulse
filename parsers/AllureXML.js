import { Webhooks } from "@qasymphony/pulse-sdk";
import xml2js from "xml2js";

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find((t) => t.name === name);
        return t
            ? new Webhooks().invoke(t, payload)
            : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    let { projectId, testcycle, result } = body;
    let testLogs = [];

    let testResults = Buffer.from(result, "base64").toString("utf8");
    xml2js.parseString(
        testResults,
        {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false,
        },
        function (err, result) {
            if (err) {
                console.error("[ERROR]: Unexpected Error Parsing XML Document: " + err);
                return;
            }
            console.log(result);
            console.log(result["ns2:test-suite"]);
            let testSuiteName = result["ns2:test-suite"].name.trim();
            let testCases = Array.isArray(result["ns2:test-suite"]["test-cases"]["test-case"])
                ? result["ns2:test-suite"]["test-cases"]["test-case"]
                : [result["ns2:test-suite"]["test-cases"]["test-case"]];

            testCases.forEach(function (testCase) {
                let testSteps = [];
                console.log();
                console.log("TEST_CASE" + testCase);
                let {
                    name: testCaseName,
                    $: { start: testCaseStartDate, stop: testCaseEndDate, status: testCaseStatus },
                    steps,
                } = testCase;
                console.log("[INFO]: Test Case: " + testCaseName);
                console.log("[INFO]: Test Case Status: " + testCaseStatus);

                let testCaseSteps = steps && steps.step ? (Array.isArray(steps.step) ? steps.step : [steps.step]) : [];
                let stepNumber = 1;
                console.log(testCaseStartDate, testCaseEndDate);
                testCaseSteps.forEach(function (testStep) {
                    console.log("[INFO]: Test Step " + stepNumber + ": " + testStep.name);
                    let testStepObj = {
                        description: testStep.name,
                        expected_result: testStep.name,
                        actual_result: testStep.name,
                        order: stepNumber,
                        status: testStep.$.status,
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
                    test_step_logs: testSteps,
                };

                testLogs.push(testLog);
            });

            let formattedResults = {
                projectId: projectId,
                testcycle: testcycle,
                logs: testLogs,
            };

            emitEvent("UpdateQTestWithFormattedResults", formattedResults);
            console.log("[INFO]: Results shipped to qTest.");
        }
    );
};
