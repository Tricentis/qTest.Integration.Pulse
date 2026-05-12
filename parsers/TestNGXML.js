import xml2js from "xml2js";
import { Webhooks } from "@qasymphony/pulse-sdk";

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find((t) => t.name === name);
        return t
            ? new Webhooks().invoke(t, payload)
            : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    function convertUTCToISO(utcTimestamp) {
        // Replace ' UTC' with 'Z' to convert to ISO 8601 format
        const isoTimestamp = utcTimestamp.replace(" UTC", "Z");
        return new Date(isoTimestamp).toISOString();
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    let payload = body;
    let projectId = payload.projectId;
    let cycleId = payload.testcycle;

    let testResults = Buffer.from(payload.result, "base64").toString("utf8");

    xml2js.parseString(
        testResults,
        {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false,
        },
        async function (err, result) {
            if (err) {
                emitEvent("ChatOpsEvent", { message: "Error: Unexpected Error Parsing XML Document: " + err });
                console.log("Error: Unexpected Error Parsing XML Document: " + err);
                return;
            }

            let topLevel = result["testng-results"].suite.$.name;
            console.log("[INFO]: Top Level Name: ", topLevel);

            // Check if 'suite' and 'test' arrays exist
            if (!result["testng-results"].suite || !result["testng-results"].suite.test) {
                console.log("[INFO]: No test suites found.");
                return;
            }

            let testSuites = Array.isArray(result["testng-results"].suite.test)
                ? result["testng-results"].suite.test
                : [result["testng-results"].suite.test];

            console.log(`[INFO]: Processing ${testSuites.length} test suites.`);

            for (const ts of testSuites) {
                let suiteName = ts.$.name;
                console.log("[INFO]: Suite Name: ", suiteName);

                // Check if 'class' array exists
                if (!ts.class) {
                    console.log("[INFO]: No test cases found in suite: ", suiteName);
                    continue;
                }

                let testClasses = Array.isArray(ts.class) ? ts.class : [ts.class];
                console.log(`[INFO]: Processing ${testClasses.length} test cases.`);
                let testLogs = [];

                for (const tc of testClasses) {
                    let className = tc.$.name;
                    console.log("[INFO]: Class Name: ", className);
                    let methodStatus;
                    testLogs = [];
                    let testSteps = [];
                    let order = 0;

                    // Check if 'test-method' array exists
                    if (!tc["test-method"]) {
                        console.log("[INFO]: No test methods found in class: ", className);
                        continue;
                    }

                    // Below is an all-lowercase array of housekeeping methods that should not have results recorded in qTest.
                    const invalidMethods = [
                        "endtest",
                        "setup",
                        "suitesetup",
                        "beforesuite",
                        "aftermethod",
                        "beforemethod",
                        "beforetest",
                        "beforeclass",
                        "afterclass",
                        "aftersuite",
                        "aftertest",
                        "testbreakdown",
                        "reset",
                        "teardown",
                    ];
                    let testMethods = Array.isArray(tc["test-method"]) ? tc["test-method"] : [tc["test-method"]];
                    console.log(`[INFO]: Processing ${testMethods.length} test methods.`);

                    for (const tm of testMethods) {
                        let methodName = tm.$.name;
                        if (!invalidMethods.includes(methodName.toLowerCase())) {
                            testSteps = [];
                            console.log("[INFO]: Method Name: ", methodName);
                            methodStatus = tm.$.status;
                            let automationContent = `${className}-${methodName}`;
                            let exe_start_date = convertUTCToISO(tm.$["started-at"]);
                            let exe_end_date = convertUTCToISO(tm.$["finished-at"]);
                            let methodDescription = tm.description || methodName;
                            let stackException;
                            let paramList = [];
                            let encodedMethodAttachment;

                            // Flatten the params structure into a plaintext list of params
                            if (tm.params && tm.params.param) {
                                let paramArray = Array.isArray(tm.params.param) ? tm.params.param : [tm.params.param];
                                console.log(`[INFO]: Processing ${paramArray.length} parameters.`);
                                paramArray.forEach((param) => {
                                    paramList.push(
                                        typeof param.value === "object"
                                            ? JSON.stringify(param.value)
                                            : param.value.trim()
                                    );
                                });
                                paramList = "_" + paramList.join("-");
                                automationContent += paramList; // Append the params to the automation content
                            }

                            let stepLog = {
                                order: order,
                                exe_date: exe_start_date,
                                description: methodName,
                                expected_result: methodName,
                                actual_result: methodName,
                                status: methodStatus,
                            };

                            testSteps.push(stepLog);

                            let testLog = {
                                status: methodStatus,
                                name: methodName,
                                attachments: [],
                                exe_start_date: exe_start_date,
                                exe_end_date: exe_end_date,
                                automation_content: automationContent,
                                note: methodDescription,
                                module_names: [topLevel, suiteName, className],
                                test_step_logs: testSteps,
                                attachments: [],
                            };

                            if (methodStatus == "FAIL") {
                                stackMessage = tm.exception.message;
                                stackException = tm.exception["full-stacktrace"];
                                let methodAttachment = `Message:\n${stackMessage}\n\nStack Trace:\n${stackException}`;
                                encodedMethodAttachment = Buffer.from(methodAttachment, "utf-8").toString("base64");
                                testLog.attachments.push({
                                    name: `stack-trace-${methodName}-${exe_start_date
                                        .toString()
                                        .replace(/:/g, "-")}.txt`,
                                    content_type: "text/plain",
                                    data: encodedMethodAttachment,
                                });
                            }

                            testLogs.push(testLog);
                        } else {
                            console.log(`[INFO]: ${methodName} is a housekeeping task and is not a valid test result.`);
                        }
                    }

                    if (testLogs.length > 0) {
                        let formattedResults = {
                            projectId: projectId,
                            testcycle: cycleId,
                            logs: testLogs,
                        };

                        console.log(`[DEBUG]: ${JSON.stringify(formattedResults)}`);
                        emitEvent("UpdateQTestWithFormattedResults", formattedResults);
                        await sleep(2000); // Sleep for 2 seconds after each test class
                    } else {
                        console.log(
                            "[INFO] Class had 0 valid test methods (likely all housekeeping tasks), skipping..."
                        );
                    }
                }
            }
        }
    );
    console.log("WORKS");
};
