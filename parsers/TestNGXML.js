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
                let exe_start_date = timestamp;
                let methodStatus = 'PASS';
                testSteps = [];
                let order = 0;

                // Check if 'test-method' array exists
                if (!tc['test-method']) {
                    console.log('[INFO]: No test methods found in class: ', className);
                    return;
                }

                const invalidMethods = ['afterMethod', 'beforeMethod', 'beforeTest', 'beforeClass', 'afterClass', 'testBreakdown', 'Reset'];
                let testMethods = Array.isArray(tc['test-method']) ? tc['test-method'] : [tc['test-method']];
                console.log(`[INFO]: Processing ${testMethods.length} test methods.`);

                testMethods.forEach(function(tm) {
                    let methodName = tm.$.name;
                    if(!invalidMethods.includes(methodName)) {
                        console.log('[INFO]: Method Name: ', methodName);
                        methodStatus = tm.$.status;
                        let stackException;
                        let reporterOutput;
                        let paramList = [];

                        // Grab the stack trace if it is a failed test, since these only exist in failures
                        if (methodStatus == 'FAIL') {
                            stackException = tm.exception['full-stacktrace'];
                        }

                        // Flatten the params structure into a plaintext list of params
                        if (tm.params && tm.params.param) {
                            let paramArray = Array.isArray(tm.params.param) ? tm.params.param : [tm.params.param];
                            console.log(`[INFO]: Processing ${paramArray.length} parameters.`);
                            paramArray.forEach(function(param) {
                                if (typeof param.value === 'object') {
                                    console.log(`[INFO]: Processing parameter: ${JSON.stringify(param.value)}`);
                                    paramList.push(JSON.stringify(param.value));
                                } else if (typeof param.value === 'string') {
                                    console.log(`[INFO]: Processing parameter: ${param.value.trim()}`);
                                    paramList.push(param.value.trim());
                                } else {
                                    console.log(`[ERROR]: Unexpected param value type: ${typeof param.value}`);
                                }
                            });
                            paramList = paramList.join('\n');
                            console.log(paramList);
                        }
                        
                        // Flatten the reporter-output structure into a plaintext list of reporter output
                        console.log(`[INFO]: Processing reporter output entries.`);
                        if (Array.isArray(tm['reporter-output'])) {
                            let lines = tm['reporter-output'].reduce((acc, item) => {
                                if (item.line) {
                                    acc.push(...item.line.map(line => line.trim().replace('\n','')));
                                }
                                return acc;
                            }, []);
                        
                            reporterOutput = lines.join('\n');
                            //console.log(reporterOutput);
                        } else if (tm['reporter-output'] && Array.isArray(tm['reporter-output'].line)) {
                            reporterOutput = tm['reporter-output'].line.join('\n');
                            //console.log(reporterOutput);
                        } else if (tm['reporter-output'] && typeof tm['reporter-output'].line === 'string') {
                            reporterOutput = tm['reporter-output'].line;
                            //console.log(tm['reporter-output'].line);
                        }

                        // Mongle all these together into a single text file attachment, if they are populated
                        let stepAttachment = `${paramList !== undefined ? 'Parameters:\n' + paramList + '\n\n' : ''}${reporterOutput !== undefined ? 'Reporter Output:\n' + reporterOutput + '\n\n' : ''}${stackException !== undefined ? 'Exception Stack:\n' + stackException : ''}`;
                        // Base64 encode the mongled text for our API to consume it without complaining
                        let encodedStepAttachment = Buffer.from(stepAttachment, 'utf-8').toString('base64');

                        let stepLog = {
                            order: order,
                            exe_date: exe_start_date,
                            description: methodName,
                            expected_result: methodName,
                            actual_result: methodName,
                            status: methodStatus,
                            attachments: [
                                {
                                    'name': `${methodName}-${exe_start_date.toString().replace(/:/g,'-')}.txt`,
                                    'content_type': 'text/plain',
                                    'data': encodedStepAttachment
                                }
                            ]
                        };

                        testSteps.push(stepLog);
                        order++;
                    } else {
                        console.log(`[INFO]: ${methodName} is a housekeeping task and is not a valid test result.`);
                    }
                });
            
                let exe_end_date = timestamp;
                exe_end_date.setSeconds(exe_start_date.getSeconds() + (Math.floor(tc.$.time || 0)));

                let testLog = {
                    status: methodStatus,
                    name: className,
                    attachments: [],
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