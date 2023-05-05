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
        var projectId = payload.projectId;
        var cycleId = payload.testcycle;
        var testLogs = [];

        let testResults = Buffer.from(payload.result, 'base64').toString('utf8');
        
        var timestamp = new Date();

        xml2js.parseString(testResults, {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false
        }, function (err, result) {
            if (err) {
                emitEvent('ChatOpsEvent', { Error: "Unexpected Error Parsing XML Document: " + err }); 
            } else {
                var testsuites = Array.isArray(result['testng-results'].suite.test) ? result['testng-results'].suite.test : [result['testng-results'].suite.test];
                testsuites.forEach(function(ts) {
                    suiteName = ts.$.name;
                    var testcases = Array.isArray(ts.class) ? ts.class : [ts.class];
                    testcases.forEach(function(obj) {
                        var className = obj.$.name;
                        var testMethods = Array.isArray(obj['test-method']) ? obj['test-method'] : [obj['test-method']];
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
                    });
                });
            }
        });

        var formattedResults = {
            "projectId" : projectId,
            "testcycle": cycleId,
            "logs" : testLogs
        };

        emitEvent('UpdateQTestWithFormattedResults', formattedResults );
    }
