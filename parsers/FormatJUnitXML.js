const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

        const xml2js = require("xml2js");
                
        var payload = body;
        var testResults = payload.result; 
        var projectId = payload.projectId;
        var cycleId = payload["test-cycle"];
        var testLogs = [];
        var requiresDecode = payload.requiresDecode;

        if(requiresDecode == 'true') {
            var xmlString = decodeURI(testResults);
            xmlString = xmlString.replace(/`/g, '&');
        }

        xml2js.parseString(xmlString, {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false
        }, function (err, result) {
            if (err) {
                emitEvent('<INSERT NAME OF CHATOPS INTEGRATION RULE HERE>', { Error: "Unexpected Error Parsing XML Document: " + err }); 
            } else {
                var testsuites = Array.isArray(result['testsuites']) ? result['testsuites'] : [result['testsuites']];
                testsuites.forEach(function(testsuite) {
                    suiteName = testsuite.$.name;
                    console.log(suiteName)
                    var testcases = Array.isArray(testsuite.testcase) ? testsuite.testcase : [testsuite.testcase];
                    testcases.forEach(function(testcase) {
                        var className = testcase.$.name;
                        console.log(className)
                        /*
                        var testFailure = Array.isArray(obj['failure']) ? obj['failure'] : [obj['failure']];
                        testMethods.forEach(function(tm) {
                            var methodName = tm.$.name;
                            var methodStatus = tm.$.status;
                            var startTime = tm.$['started-at'];
                            var endTime = tm.$['finished-at'];
                            var note = '';
                            var stack = '';
                            if (methodStatus == 'FAIL') {
                            note = tm.exception.message;
                            stack = tm.exception['full-stacktrace'];
                            }
                            var exe_start_date = timestamp;
                            var exe_end_date = timestamp;
                            exe_end_date.setSeconds(exe_start_date.getSeconds() + (Math.floor(obj.$.time || 0)));
                            var testLog = {
                            status: methodStatus,
                            name: methodName,
                            attachments: [],
                            note: note,
                            exe_start_date: exe_start_date.toISOString(),
                            exe_end_date: exe_start_date.toISOString(),
                            automation_content: className + "#" + methodName,
                            module_names: [suiteName, className, methodName]
                            };
                            if (stack !== '') {
                            testLog.attachments.push({
                                name: `${methodName}.txt`,
                                data: Buffer.from(stack).toString("base64"),
                                content_type: "text/plain"
                            });
                            }
                            //testLog.attachments.push(payload.consoleOutput[0]);
                            testLogs.push(testLog);
                        });
                        */
                    });
                });
            }
        });

        var formattedResults = {
            "projectId" : projectId,
            "test-cycle" : cycleId,
            "logs" : testLogs
        };

        emitEvent('<INSERT NAME OF CHATOPS INTEGRATION RULE HERE>', { ResultsFormatSuccess: "Results formatted successfully for project"}); 
        emitEvent('<INSERT NAME OF UPDATE QTEST RULE HERE>', formattedResults );

};
