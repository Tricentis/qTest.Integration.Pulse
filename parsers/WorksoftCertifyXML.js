// This parser is for XML results from the Worksoft Certify API.
// Documentation on accessing results via the API may be found here:
// https://docs.worksoft.com/Worksoft_Certify/Certify_Results_API/How_To_Section_Certify_Results_API.htm

const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }
                
        let payload = body;
        let projectId = payload.projectId;
        let cycleId = payload.testcycle;
        let parsedtestcases = [];

        let testResults = Buffer.from(payload.result, 'base64').toString('utf8');

        //console.log(testResults);

        let parseString = require('xml2js').parseString;
        parseString(testResults, {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false,
            emptyTag: "..."
        }, function (err, result) {
            if (err) {
                emitEvent('ChatOpsEvent', { Error: "Unexpected Error Parsing XML Document: " + err }); 
                console.log(err);
            } else {              
                if (result.CertifyResults) {                    
                    console.log(JSON.stringify(result));
                    let testsuite = result.CertifyResults;
                    let suitename = testsuite.LogHeader.LogHeaderDetails.Title;
                    console.log('Suite Name: ' + suitename);
                    if (testsuite.LogTestStepDetails) {
                        let testcasesandsteps = Array.isArray(testsuite.LogTestStepDetails) ? testsuite.LogTestStepDetails : [testsuite.LogTestStepDetails];
                            testcasesandsteps.forEach(function(testcaseandstep) {
                            let casenameandstepnumber = testcaseandstep.StepName.replace(/=>:/g, '').replace(' - Step ', '|').split('|');
                            let casename = casenameandstepnumber[0];
                            let stepnumber = casenameandstepnumber[1];
                            let casestatus = testcaseandstep.Status;
                            let startTime = parseDateString(testcaseandstep.ExecDate + ' ' + testcaseandstep.ExecTime);
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
                                exe_date: startTime
                            };

                            console.log('Case Name: ' + casename);
                            console.log('Case Step #: ' + stepnumber);
                            console.log('Case Step Name: ' + casestepdescription);
                            console.log('Case Time: ' + startTime);
                            
                            // Check to see if test case exists, and if so, append the test step and update the exe end date
                            let existingTestCase = parsedtestcases.find(tc => tc.name === casename);
                            if (existingTestCase) {
                                existingTestCase.test_step_logs.push(casestep);
                                existingTestCase.exe_end_date = casestep.exe_date;
                            } else {
                                // Otherwise create a new test case
                                let testcase = {
                                    status: casestatus,
                                    name: casename,
                                    attachments: [],
                                    note: casestepnote,
                                    exe_start_date: startTime,
                                    exe_end_date: endTime,
                                    automation_content: htmlEntities(casename),
                                    module_names: [suitename],
                                    test_step_logs: []
                                };
                                testcase.test_step_logs.push(casestep);
                                parsedtestcases.push(testcase);
                            }
                        });
                    } else {
                        console.log('Test Suite has no Test Cases, skipping.  This is probably a bad thing.  Check your execution.');
                    }
                }
            }   
        });

        // Reconcile Test Step statuses with the Test Case
        parsedtestcases.forEach(testCase => {
            // Initialize variables to track if any step failed or was skipped
            let hasFailed = false;
            let hasSkipped = false;
        
            // Iterate through test steps of the current test case
            testCase.test_step_logs.forEach(step => {
                if (step.status === 'failed') {
                    hasFailed = true;
                } else if (step.status === 'skipped' && !hasFailed) {
                    hasSkipped = true;
                }
            });
        
            // Update test case status based on the results of test steps
            if (hasFailed) {
                testCase.status = 'failed';
            } else if (hasSkipped) {
                testCase.status = 'skipped';
            } else {
                testCase.status = 'passed';
            }
        });

        // Create final results objects to send to the next rule
        let formattedResults = {
            "projectId" : projectId,
            "testcycle": cycleId,
            "logs" : parsedtestcases
        };

        // #sendit
        console.log(JSON.stringify(formattedResults));
        emitEvent('UpdateQTestWithFormattedResults', formattedResults );

};

function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseDateString(dateString) {
    // Split the date string into its components
    var parts = dateString.split(/[\s/:]+/);

    // Extract components
    var month = parseInt(parts[0], 10); // Month is 0-indexed in JavaScript Date object
    var day = parseInt(parts[1], 10);
    var year = parseInt(parts[2], 10);
    var hour = parseInt(parts[3], 10);
    var minute = parseInt(parts[4], 10);
    var second = parseInt(parts[5], 10);

    // Create a Date object with the components
    var date = new Date(year, month - 1, day, hour, minute, second);

    // Return the ISO string representation of the date
    return date.toISOString();
}