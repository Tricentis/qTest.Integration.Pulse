const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    let testRun;
    let testLogs = [];
    let lastEndTime = 0;

    function getCases(arr) {
        if (!Array.isArray(arr)) {
            return;
        }
        console.log('[INFO]: Log Level - ' + logLevel);
        for (let r = 0, rlen = arr.length; r < rlen; r++) {
            let currentSuite = arr[r];
            if (currentSuite.hasOwnProperty('test-case')) {
                let currentCases = Array.isArray(currentSuite['test-case']) ? currentSuite['test-case'] : [currentSuite['test-case']];
                for (let c = 0, clen = currentCases.length; c < clen; c++) {
                    let currentCase = currentCases[c];
                    let className = currentCase.$.name;
                    console.log('Case Name: ' + className);
                    let moduleNames = currentCase.$.classname.split('.');
                    let classStatus = currentCase.$.result;
                    let startTime = lastEndTime === 0 ? new Date(Date.parse(testRun.$['start-time'].replace(' ', '').replace('Z', '.000Z'))) : lastEndTime.toISOString();
                    let interim = parseFloat(currentCase.$.duration);
                    let endTime = new Date(Date.parse(startTime) + interim).toISOString();

                    let note = '';
                    let stack = '';
                    let testFailure = currentCase.failure;
                    if (testFailure) {
                        console.log(testFailure.message);
                        note = testFailure.message;
                        console.log(testFailure['stack-trace']);
                        stack = testFailure['stack-trace'];
                    }

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
                }
            }
            if (currentSuite.hasOwnProperty('test-suite')) {
                let subSuite = Array.isArray(currentSuite['test-suite']) ? currentSuite['test-suite'] : [currentSuite['test-suite']];
                getCases(subSuite);
            }
        }
    }

    let payload = body;
    let projectId = payload.projectId;
    let cycleId = payload.testcycle;
    let testResults = Buffer.from(payload.result, 'base64').toString('utf8');

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
            console.log('[INFO]: XML converted to JSON: \n' + JSON.stringify(result));
            testRun = result['test-run'];
            if (result['test-run']['test-suite']) {
                let testsuites = Array.isArray(result['test-run']['test-suite']) ? result['test-run']['test-suite'] : [result['test-run']['test-suite']];
                getCases(testsuites);
            } else {
                console.log('Test Suites collection is empty, skipping.');
            }
        }

        let formattedResults = {
            "projectId": projectId,
            "testcycle": cycleId,
            "logs": testLogs
        };

        emitEvent('UpdateQTestWithResults', formattedResults);
    });
};

function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
