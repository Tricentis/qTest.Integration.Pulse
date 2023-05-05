const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');
const {
    Webhooks
} = require('@qasymphony/pulse-sdk');

exports.handler = function({
        event: body,
        constants,
        triggers
    }, context, callback) {
        function emitEvent(name, payload) {
            let t = triggers.find(t => t.name === name);
            return t && new Webhooks().invoke(t, payload);
        }

        var payload = body;
        var projectId = payload.projectId;
        var cycleId = payload.testcycle;
        var testLogs = [];

        let testResults = Buffer.from(payload.result, 'base64').toString('utf8');

        xml2js.parseString(testResults, {
                preserveChildrenOrder: true,
                explicitArray: false,
                explicitChildren: false
            }, function(err, result) {
                if (err) {
                    //emitEvent('ChatOpsEvent', { message: "[ERROR]: Unexpected Error Parsing XML Document: " + err }); 
                    console.log('[ERROR]: Unexpected Error Parsing XML Document: ' + err);
                } else {
                    console.log('[INFO]: XML converted to JSON: \n' + JSON.stringify(result));
                    var testSuiteName = result['ns2:test-suite'].name.trim().split(':')[0];
                    var testCaseName = result['ns2:test-suite'].name.trim()
                	console.log('[INFO]: Test Case: ' + testCaseName);
                    var testCaseStatus = 'passed';
                    var testCaseStartDate = new Date(parseInt(result['ns2:test-suite'].$.start)).toISOString();
                    var testCaseEndDate = new Date(parseInt(result['ns2:test-suite'].$.start)).toISOString();
                    var testCaseSteps = Array.isArray(result['ns2:test-suite']['test-cases']['test-case']) ? result['ns2:test-suite']['test-cases']['test-case'] : [result['ns2:test-suite']['test-cases']['test-case']];
       				var testSteps = [];
                    var stepNumber = 1;

                    testCaseSteps.forEach(function(testStep) {

                    if (testStep.$.status != 'passed') {
                    	testCaseStatus = testStep.$.status;
                    }
                    console.log('[INFO]: Test Case Status: ' + testCaseStatus);
                    	
                    console.log('[INFO]: Test Step ' + stepNumber + ': ' + testStep.name);
                    	var testStep = {
                                "description": testStep.name,
                                "expected_result": testStep.name,
                                "actual_result": testStep.name,
                                "order": stepNumber,
                                "status": testStep.$.status
                            };

                    	testSteps.push(testStep);
                    	stepNumber++;

                    })


                    var testLog = {
                        status: testCaseStatus,
                        name: testCaseName,
                        attachments: [],
                        exe_start_date: testCaseStartDate,
                        exe_end_date: testCaseEndDate,
                        automation_content: testCaseName,
                        module_names: [testSuiteName],
                        test_step_logs: testSteps
                    };

                    testLogs.push(testLog);

                }

            })

	    var formattedResults = {
	        "projectId": projectId,
	        "testcycle": cycleId,
	        "logs": testLogs
	    };

	    emitEvent('UpdateQTestWithFormattedResults', formattedResults);
	    console.log('[INFO]: Results shipped to qTest.');

    }