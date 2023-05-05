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
        var projectId = payload.projectId;
        var cycleId = payload.testcycle;
        var testLogs = [];

        let testResults = Buffer.from(payload.result, 'base64').toString('utf8');

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
                emitEvent('ChatOpsEvent', { message: "Unexpected Error Parsing XML Document: " + err }); 
                console.log('[ERROR]: ' + err);
            } else {
                var classStatus = '';
                var testsuites = Array.isArray(result.testSuiteResults['testSuite']) ? result.testSuiteResults['testSuite'] : [result.testSuiteResults['testSuite']];
                testsuites.forEach(function(testsuite) {
                    lastEndTime = 0;
                    suiteName = testsuite.testSuiteName;
                    console.log('[INFO]: Suite Name: ' + suiteName);
                    var testcases = Array.isArray(testsuite.testRunnerResults['testCase']) ? testsuite.testRunnerResults['testCase'] : [testsuite.testRunnerResults['testCase']];
                    testcases.forEach(function(testcase) {
                        className = testcase.testCaseName;
                        console.log('[INFO]: Class Name: ' + className);
                        classId = testcase.testCaseId;
                        var moduleNames = [suiteName];
                        var stack = '';

                        console.log('[INFO]: Class Status: ' + testcase.status);

                        if(testcase.status == 'OK' || testcase.status == 'PASS' || testcase.status == 'FINISHED') {
                            classStatus = 'PASSED';
                        } else if(testcase.status == 'FAIL'){
                            classStatus = 'FAILED';
                        } else if (testcase.status == 'UNKNOWN'){
                            classStatus = 'SKIPPED';
                        }
                        console.log('[INFO]: Translated Status: ' + classStatus);

                        var teststeps = Array.isArray(testcase.testStepResults['result']) ? testcase.testStepResults['result'] : [testcase.testStepResults['result']];
                        var teststepparams = Array.isArray(testcase.testStepParameters['parameters']) ? testcase.testStepParameters['parameters'] : [testcase.testStepParameters['parameters']];
                        var testStepLogs = [];
                        teststeps.forEach(function(teststep) {
                            var stepStatus = '';

                            teststepparams.forEach(function(teststepparam){
                                if(teststepparam.testStepName == teststep.name) {
                                    testStepParam = teststepparam.iconPath;
                                }
                            });

                            if(lastEndTime == 0) {
                                startTime = new Date();
                            } else {
                                startTime = lastEndTime;
                            }
                            interim = new Date(Date.parse(startTime)).getSeconds() + parseFloat(teststep.timeTaken/1000);
                            endTime = new Date(Date.parse(startTime)).setSeconds(interim);
                            endTime = new Date(endTime).toISOString();

                            if(teststep.status == 'OK' || teststep.status == 'PASS' || teststep.status == 'FINISHED') {
                                stepStatus = 'PASSED';
                            } else if(teststep.status == 'FAIL'){
                                stepStatus = 'FAILED';
                            } else if (teststep.status == 'UNKNOWN'){
                                stepStatus = 'SKIPPED';
                            }

                            if(stepStatus == 'FAILED'){                                
                                var testFailure = Array.isArray(testcase.failedTestSteps['error']) ? testcase.failedTestSteps['error'] : [testcase.failedTestSteps['error']];
                                testFailure.forEach(function(failure) {
                                    if(failure !== undefined) {
                                        if(failure.testStepName == teststep.name) {
                                            stack = failure.detail;
                                        }                                        
                                    }
                                });
                            }

                            var testStepLog = {
                                order: (teststep.order - 1),
                                description: teststep.name,
                                expected_result: testStepParam,
                                actual_result: teststep.message,
                                status: stepStatus,
                                attachments: [],
                            };

                            if (stack !== '') {
                                testStepLog.attachments.push({
                                name: `${className}.txt`,
                                data: Buffer.from(stack).toString("base64"),
                                content_type: "text/plain"
                                });
                            }

                        testStepLogs.push(testStepLog);
                        })


                        var note = '';

                        var testLog = {
                            status: classStatus,
                            name: className,
                            attachments: [],
                            note: note,
                            exe_start_date: startTime,
                            exe_end_date: endTime,
                            automation_content: htmlEntities(className),
                            module_names: moduleNames,
                            test_step_logs: testStepLogs
                        };

                        //testLog.attachments.push(payload.consoleOutput[0]);
                        testLogs.push(testLog);
                        lastEndTime = endTime;
                    });
                });
            }
        });

        var formattedResults = {
            "projectId" : projectId,
            "testcycle" : cycleId,
            "logs" : testLogs
        };

        emitEvent('ChatOpsEvent', { ResultsFormatSuccess: "Results formatted successfully for ReadyAPI."}); 
        console.log('[INFO]: Results formatted successfully for ReadyAPI.');
        emitEvent('UpdateQTestWithFormattedResults', formattedResults );

};