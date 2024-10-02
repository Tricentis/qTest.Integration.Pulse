import { Webhooks } from "@qasymphony/pulse-sdk";
import xml2js from "xml2js";

exports.handler = async function ({ event: body, triggers }) {
    function emitEvent(name, payload) {
        let t = triggers.find((t) => t.name === name);
        return t
            ? new Webhooks().invoke(t, payload)
            : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    let payload = body;
    let projectId = payload.projectId;
    let testcycle = payload.testcycle;

    let testResults = Buffer.from(payload.result, "base64").toString("utf8");

    let testLogs = [];

    function formatDate(obj) {
        if (obj.length < 9) {
            return null;
        }
        let year = obj.substring(0, 4);
        let month = obj.substring(4, 6);
        let day = obj.substring(6, 8);
        let time = obj.substring(9, obj.length);
        return year + "-" + month + "-" + day + "T" + time + "Z";
    }

    xml2js.parseString(
        testResults,
        {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false,
        },
        function (err, result) {
            if (err) {
                emitEvent("ChatOpsEvent", { message: "[ERROR]: Unexpected Error Parsing XML Document: " + err });
            } else {
                console.log("[DEBUG]: " + JSON.stringify(result));
                let testSuites = Array.isArray(result.robot.suite) ? result.robot.suite : [result.robot.suite];
                testSuites.forEach(function (suiteobj) {
                    let testcases = Array.isArray(suiteobj.test) ? suiteobj.test : [suiteobj.test];
                    testcases.forEach(function (obj) {
                        let testCaseName = obj.$.name;
                        let startingTime = formatDate(obj.status.$.starttime);
                        let endingTime = formatDate(obj.status.$.endtime);
                        let note = "";
                        let testMethods = Array.isArray(obj.kw) ? obj.kw : [obj.kw];
                        testMethods.forEach(function (tm) {
                            let methodName = tm.$.name;
                            let status = tm.status.$.status;
                            let stepCount = 0;
                            let stepLog = [];
                            if (Array.isArray(tm.kw)) {
                                let testStepsArray = tm.kw;
                                testStepsArray.forEach(function (ts) {
                                    stepLog.push({
                                        order: stepCount++,
                                        status: ts.status.$.status,
                                        description: ts.$.name,
                                        expected_result: ts.doc,
                                    });
                                    if (ts.msg !== undefined) {
                                        note = ts.msg._;
                                    }
                                });
                            }
                            let testLog = {
                                status: status,
                                name: methodName,
                                note: note,
                                exe_start_date: startingTime,
                                exe_end_date: endingTime,
                                automation_content: testCaseName + "#" + methodName,
                                test_step_logs: stepLog,
                                module_names: [testCaseName, methodName],
                            };
                            testLogs.push(testLog);
                        });
                    });
                });
            }
        }
    );

    let formattedResults = {
        projectId: projectId,
        testcycle: testcycle,
        logs: testLogs,
    };

    //emitEvent('ChatOpsEvent', { ResultsFormatSuccess: "Results formatted successfully for project" });
    emitEvent("UpdateQTestWithFormattedResults", formattedResults);
    console.log("Parsing DONE successfully");
};
