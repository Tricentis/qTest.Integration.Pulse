const xml2js = require('xml2js');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    let payload = body;
    let projectId = payload.projectId;
    let cycleId = payload.testcycle;
    let testLogs = [];
    let testSteps = [];
    let timestamp = new Date();

    let testResults = Buffer.from(payload.result, 'base64').toString('utf8');

    xml2js.parseString(testResults, {
        preserveChildrenOrder: true,
        explicitArray: false,
        explicitChildren: false
    }, function (err, result) {
        if (err) {
            emitEvent('ChatOpsEvent', { message: "Error: Unexpected Error Parsing XML Document: " + err });
            console.log("Error: Unexpected Error Parsing XML Document: " + err );
            return;
        }

        let topLevel = result['testng-results'].suite.$.name;
        console.log('[INFO]: Top Level Name: ', topLevel);

        // Check if 'suite' and 'test' arrays exist
        if (!result['testng-results'].suite || !result['testng-results'].suite.test) {
            console.log('[INFO]: No test suites found.');
            return;
        }

        let testSuites = Array.isArray(result['testng-results'].suite.test) ? result['testng-results'].suite.test : [result['testng-results'].suite.test];

        console.log(`[INFO]: Processing ${testSuites.length} test suites.`);

        testSuites.forEach(function(ts) {
            let suiteName = ts.$.name;
            console.log('[INFO]: Suite Name: ', suiteName);

            // Check if 'class' array exists
            if (!ts.class) {
                console.log('[INFO]: No test cases found in suite: ', suiteName);
                return;
            }

            let testCases = Array.isArray(ts.class) ? ts.class : [ts.class];
            console.log(`[INFO]: Processing ${testCases.length} test cases.`);

            testCases.forEach(function(tc) {
                let className = tc.$.name;
                console.log('[INFO]: Class Name: ', className);
                let note = '';
                let exe_start_date = timestamp;
                let methodStatus = 'PASS';
                testSteps = [];
                let order = 0;

                // Check if 'test-method' array exists
                if (!tc['test-method']) {
                    console.log('[INFO]: No test methods found in class: ', className);
                    return;
                }

                //const invalidMethods = ['afterMethod', 'beforeMethod', 'beforeTest', 'beforeClass', 'afterClass', 'testBreakdown'];
                let testMethods = Array.isArray(tc['test-method']) ? tc['test-method'] : [tc['test-method']];
                console.log(`[INFO]: Processing ${testMethods.length} test methods.`);

                testMethods.forEach(function(tm) {
                    let methodName = tm.$.name;
                    console.log('[INFO]: Method Name: ', methodName);
                    methodStatus = tm.$.status;

                    if (methodStatus == 'FAIL') {
                        note += tm.exception['full-stacktrace'];
                    }

                    let stepLog = {
                        order: order,
                        exe_date: exe_start_date,
                        description: methodName,
                        expected_result: methodName,
                        actual_result: methodName,
                        status: methodStatus
                    };

                    testSteps.push(stepLog);
                    order++;
                });
            
                let exe_end_date = timestamp;
                exe_end_date.setSeconds(exe_start_date.getSeconds() + (Math.floor(tc.$.time || 0)));

                let testLog = {
                    status: methodStatus,
                    name: className,
                    attachments: [],
                    note: note,
                    exe_start_date: exe_start_date.toISOString(),
                    exe_end_date: exe_end_date.toISOString(),
                    automation_content: suiteName + '#' + className,
                    module_names: [topLevel, suiteName],
                    test_step_logs: testSteps
                };

                testLogs.push(testLog);

            });
        });

        let formattedResults = {
            "projectId" : projectId,
            "testcycle": cycleId,
            "logs" : testLogs
        };

        emitEvent('UpdateQTestWithFormattedResults', formattedResults );
    });
};