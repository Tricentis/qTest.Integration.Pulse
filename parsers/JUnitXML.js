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

    let testResults = Buffer.from(payload.result, 'base64').toString('utf8');

    let parseString = require('xml2js').parseString;
    let startTime = '';
    let endTime = '';
    let lastEndTime = 0;

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
            let processTestSuite = function (testsuite) {
                lastEndTime = 0;
                let suiteName = testsuite.$.name;
                console.log('Suite Name: ' + suiteName);
                let testcases = Array.isArray(testsuite.testcase) ? testsuite.testcase : [testsuite.testcase];
                testcases.forEach(function (testcase) {
                    let classArray = [];
                    classArray = testcase.$.name.replace('=>', ':').split(':');
                    let depth = classArray.length;
                    let className = classArray[(depth - 1)];
                    let moduleNames = classArray.slice(0, depth - 1).map(folder => folder.trim());
                    if (moduleNames.length === 0) {
                        moduleNames.push(suiteName);
                    }
                    console.log('Case Name: ' + className);
                    let classStatus = 'passed';
                    startTime = lastEndTime === 0 ? new Date(Date.parse(testsuite.$.timestamp)).toISOString() : lastEndTime;
                    let interim = new Date(Date.parse(startTime)).getSeconds() + parseFloat(testcase.$.time);
                    endTime = new Date(Date.parse(startTime)).setSeconds(interim);
                    endTime = new Date(endTime).toISOString();

                    let note = '';
                    let stack = '';
                    let processFailure = function (failure) {
                        if (failure) {
                            console.log(failure.$.type);
                            note = failure.$.type + ': ' + failure.$.message;
                            console.log(failure._);
                            stack = failure._;
                            classStatus = 'failed';
                        }
                    };

                    let testFailure = Array.isArray(testcase.failure) ? testcase.failure : [testcase.failure];
                    testFailure.forEach(processFailure);

                    let testError = Array.isArray(testcase.error) ? testcase.error : [testcase.error];
                    testError.forEach(function (error) {
                        if (error) {
                            console.log(error.$.message);
                            note = error.$.message;
                            classStatus = 'failed';
                        }
                    });

                    let testSkipped = Array.isArray(testcase.skipped) ? testcase.skipped : [testcase.skipped];
                    testSkipped.forEach(function (skipped) {
                        if (skipped) {
                            classStatus = 'skipped';
                        }
                    });

                    console.log(classStatus);

                    let testLog = {
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
                    testLogs.push(testLog);
                    lastEndTime = endTime;
                });
            };

            if (result.testsuites) {
                let testsuites = Array.isArray(result.testsuites['testsuite']) ? result.testsuites['testsuite'] : [result.testsuites['testsuite']];
                testsuites.forEach(processTestSuite);
            } else {
                console.log('Test Suites collection doesn\'t exist, checking for singular test suite.');
                let testsuite = result.testsuite;
                if (testsuite) {
                    processTestSuite(testsuite);
                } else {
                    console.log('No Test Suite found, exiting.');
                }
            }
        }
    });

    let formattedResults = {
        "projectId": projectId,
        "testcycle": cycleId,
        "logs": testLogs
    };

    emitEvent('UpdateQTestWithResults', formattedResults);
};

function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
