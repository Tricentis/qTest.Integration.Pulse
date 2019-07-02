const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }
                
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

        console.log(xmlString);

        var parseString = require('xml2js').parseString;
        var startTime = '';
        var endTime = '';
        var lastEndTime = 0;

        parseString(testResults, {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false
        }, function (err, result) {
            if (err) {
                emitEvent('<INSERT NAME OF CHATOPS INTEGRATION RULE HERE>', { Error: "Unexpected Error Parsing XML Document: " + err }); 
                console.log(err);
            } else {
                var testsuites = Array.isArray(result.testsuites['testsuite']) ? result.testsuites['testsuite'] : [result.testsuites['testsuite']];
                testsuites.forEach(function(testsuite) {
                    lastEndTime = 0;
                    suiteName = testsuite.$.name;
                    console.log('Suite Name: ' + suiteName)
                    var testcases = Array.isArray(testsuite.testcase) ? testsuite.testcase : [testsuite.testcase];
                    testcases.forEach(function(testcase) {
                        var classArray = [];
                        classArray = testcase.$.name.replace('=>', ':').split(':');
                        var depth = classArray.length;
                        var className = classArray[(depth - 1)];
                        var moduleNames = [];
                        var moduleCount = 0;
                        classArray.forEach(function(folder) {
                            if(moduleCount < (depth - 1)) {
                                moduleNames.push(folder.trim());
                                moduleCount++;
                            }
                        })
                        if(moduleNames.length == 0) {
                            moduleNames.push(suiteName);
                        }
                        console.log('Class Name: ' + className)
                        var classStatus = 'passed';
                        if(lastEndTime == 0) {
                            startTime = new Date(Date.parse(testsuite.$.timestamp)).toISOString();
                        } else {
                            startTime = lastEndTime;
                        }
                        interim = new Date(Date.parse(startTime)).getSeconds() + parseFloat(testcase.$.time);
                        endTime = new Date(Date.parse(startTime)).setSeconds(interim);
                        endTime = new Date(endTime).toISOString();

                        var note = '';
                        var stack = '';
                        var testFailure = Array.isArray(testcase.failure) ? testcase.failure : [testcase.failure];
                        testFailure.forEach(function(failure) {
                            if(failure !== undefined) {
                                console.log(failure.$.type)
                                note = failure.$.type + ': ' + failure.$.message;
                                console.log(failure._)
                                stack = failure._;
                                classStatus = 'failed';
                            }
                        });
                        console.log(classStatus);

                        var testLog = {
                            status: classStatus,
                            name: className,
                            attachments: [],
                            note: note,
                            exe_start_date: startTime,
                            exe_end_date: endTime,
                            automation_content: htmlEntities(className),
                            module_names: moduleNames
                        };
                        if (stack !== '') {
                        testLog.attachments.push({
                            name: `${className}.txt`,
                            data: Buffer.from(stack).toString("base64"),
                            content_type: "text/plain"
                        });
                        }
                        //testLog.attachments.push(payload.consoleOutput[0]);
                        testLogs.push(testLog);
                        lastEndTime = endTime;
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

function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
