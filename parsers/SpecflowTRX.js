// Format required: Microsoft SpecFlow .trx XML result files

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

        xml2js.parseString(testResults, {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false
        }, function (err, result) {
            if (err) {
                emitEvent('ChatOpsEvent', { message: "Unexpected Error Parsing XML Document: " + err }); 
            } else {
                var testruns = Array.isArray(result['TestRun']) ? result['TestRun'] : [result['TestRun']];
                testruns.forEach(function(ts) {
                    runName = ts.$.id;
                    var results = Array.isArray(ts['Results']) ? ts['Results'] : [ts['Results']];
                    results.forEach(function(tc) {
                        var unitTestResults = Array.isArray(tc['UnitTestResult']) ? tc['UnitTestResult'] : [tc['UnitTestResult']];
                        unitTestResults.forEach(function(tm) {
                            var testCaseName = tm.$.testName;
                            var testCaseId = tm.$.testId;
                            var testCaseStatus = tm.$.outcome;
                            if (testCaseStatus == 'NotExecuted') {
                            	testCaseStatus = 'Blocked';
                            }
                            var startTime = new Date(tm.$.startTime).toISOString();
                            var endTime = new Date(tm.$.endTime).toISOString();
                            var testLog = {
                            status: testCaseStatus,
                            name: testCaseName,
                            attachments: [],
                            exe_start_date: startTime,
                            exe_end_date: endTime,
                            automation_content: htmlEntities(testCaseId),
                            module_names: [runName]
                            };
                            var outPut = tm['Output'];
                            if ((typeof outPut !== 'undefined') && (outPut)) {
	                            var stdOut = outPut['StdOut'];
	                            console.log("Found StdOut, making attachment");
	                            if ((typeof stdOut !== 'undefined') && (stdOut)) {
		                            testLog.attachments.push({
		                                name: `${testCaseName}.log`,
		                                data: Buffer.from(stdOut).toString("base64"),
		                                content_type: "text/plain"
		                            });
	                            }
                            }

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
    };

function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
