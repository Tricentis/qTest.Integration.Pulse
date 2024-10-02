// Format required: Microsoft SpecFlow .trx XML result files
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

    xml2js.parseString(
        testResults,
        {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false,
        },
        function (err, result) {
            if (err) {
                emitEvent("ChatOpsEvent", { message: "Unexpected Error Parsing XML Document: " + err });
            } else {
                let testruns = Array.isArray(result["TestRun"]) ? result["TestRun"] : [result["TestRun"]];
                testruns.forEach(function (ts) {
                    const runName = ts.$.id;
                    let results = Array.isArray(ts["Results"]) ? ts["Results"] : [ts["Results"]];
                    results.forEach(function (tc) {
                        let unitTestResults = Array.isArray(tc["UnitTestResult"])
                            ? tc["UnitTestResult"]
                            : [tc["UnitTestResult"]];
                        unitTestResults.forEach(function (tm) {
                            let testCaseName = tm.$.testName;
                            let testCaseId = tm.$.testId;
                            let testCaseStatus = tm.$.outcome;
                            if (testCaseStatus == "NotExecuted") {
                                testCaseStatus = "Blocked";
                            }
                            let startTime = new Date(tm.$.startTime).toISOString();
                            let endTime = new Date(tm.$.endTime).toISOString();
                            let testLog = {
                                status: testCaseStatus,
                                name: testCaseName,
                                attachments: [],
                                exe_start_date: startTime,
                                exe_end_date: endTime,
                                automation_content: htmlEntities(testCaseId),
                                module_names: [runName],
                            };
                            let outPut = tm["Output"];
                            if (typeof outPut !== "undefined" && outPut) {
                                let stdOut = outPut["StdOut"];
                                console.log("Found StdOut, making attachment");
                                if (typeof stdOut !== "undefined" && stdOut) {
                                    testLog.attachments.push({
                                        name: `${testCaseName}.log`,
                                        data: Buffer.from(stdOut).toString("base64"),
                                        content_type: "text/plain",
                                    });
                                }
                            }

                            testLogs.push(testLog);
                        });
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

    emitEvent("UpdateQTestWithFormattedResults", formattedResults);
    console.log("Works");
};

function htmlEntities(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
