import xml2js from "xml2js";
import { Webhooks } from "@qasymphony/pulse-sdk";

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find((t) => t.name === name);
        return t
            ? new Webhooks().invoke(t, payload)
            : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    let payload = body;
    let projectId = payload.projectId;
    let cycleId = payload.testcycle;
    let parsedtestcases = [];

    let testResults = Buffer.from(payload.result, "base64").toString("utf8");

    let parseString = xml2js.parseStringPromise;
    try {
        let result = await parseString(testResults, {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false,
            emptyTag: "...",
        });

        if (result.CertifyResults) {
            let testsuite = result.CertifyResults;
            let suitename = testsuite.LogHeader.LogHeaderDetails.Title;

            if (testsuite.LogTestStepDetails) {
                let testcasesandsteps = Array.isArray(testsuite.LogTestStepDetails)
                    ? testsuite.LogTestStepDetails
                    : [testsuite.LogTestStepDetails];
                testcasesandsteps.forEach(function (testcaseandstep) {
                    let casenameandstepnumber = testcaseandstep.StepName.replace(/=>:/g, "")
                        .replace(" - Step ", "|")
                        .split("|");
                    let casename = casenameandstepnumber[0];
                    let stepnumber = casenameandstepnumber[1];
                    let casestatus = testcaseandstep.Status;
                    let startTime = parseDateString(testcaseandstep.ExecDate + " " + testcaseandstep.ExecTime);
                    let endTime = startTime;
                    let casestepdescription = testcaseandstep.Description;
                    let casestepexpected = testcaseandstep.Expected;
                    let casestepactual = testcaseandstep.Actual;
                    let casestepnote = testcaseandstep.ImagePath;
                    let casestep = {
                        description: casestepdescription,
                        expected_result: casestepexpected,
                        actual_result: casestepactual,
                        order: stepnumber,
                        status: casestatus,
                        exe_date: startTime,
                    };

                    let existingTestCase = parsedtestcases.find((tc) => tc.name === casename);
                    if (existingTestCase) {
                        existingTestCase.test_step_logs.push(casestep);
                        existingTestCase.exe_end_date = casestep.exe_date;
                    } else {
                        let testcase = {
                            status: casestatus,
                            name: casename,
                            attachments: [],
                            note: casestepnote,
                            exe_start_date: startTime,
                            exe_end_date: endTime,
                            automation_content: htmlEntities(casename),
                            module_names: [suitename],
                            test_step_logs: [],
                        };
                        testcase.test_step_logs.push(casestep);
                        parsedtestcases.push(testcase);
                    }
                });
            } else {
                console.log(
                    "Test Suite has no Test Cases, skipping.  This is probably a bad thing.  Check your execution."
                );
            }
        }
    } catch (err) {
        emitEvent("ChatOpsEvent", { Error: "Unexpected Error Parsing XML Document: " + err });
        console.log(err);
    }

    parsedtestcases.forEach((testCase) => {
        let hasFailed = false;
        let hasSkipped = false;

        testCase.test_step_logs.forEach((step) => {
            if (step.status === "failed") {
                hasFailed = true;
            } else if (step.status === "skipped" && !hasFailed) {
                hasSkipped = true;
            }
        });

        if (hasFailed) {
            testCase.status = "failed";
        } else if (hasSkipped) {
            testCase.status = "skipped";
        } else {
            testCase.status = "passed";
        }
    });

    let formattedResults = {
        projectId: projectId,
        testcycle: cycleId,
        logs: parsedtestcases,
    };

    console.log(JSON.stringify(formattedResults));
    emitEvent("UpdateQTestWithFormattedResults", formattedResults);
    console.log("---WORKS---");
};

function htmlEntities(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseDateString(dateString) {
    var parts = dateString.split(/[\s/:]+/);
    var month = parseInt(parts[0], 10);
    var day = parseInt(parts[1], 10);
    var year = parseInt(parts[2], 10);
    var hour = parseInt(parts[3], 10);
    var minute = parseInt(parts[4], 10);
    var second = parseInt(parts[5], 10);
    var date = new Date(year, month - 1, day, hour, minute, second);
    return date.toISOString();
}
