const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    let testRun;
    let testCases = [];
    let logLevel = 1;
    let lastEndTime = 0;

    function getCases(arr) {
        if (!Array.isArray(arr)) {
            return testCases;
        }
        console.log('[INFO]: Log Level - ' + logLevel);
        for (let r = 0, rlen = arr.length; r < rlen; r++) {
            let currentSuite = arr[r];
            if (currentSuite.hasOwnProperty('test-case')) {
                var currentCases = Array.isArray(currentSuite['test-case']) ? currentSuite['test-case'] : [currentSuite['test-case']]
                for (let c = 0, clen = currentCases.length; c < clen; c++) {
                    currentCase = currentCases[c];
                    var className = currentCase.$.name;
                    console.log('Case Name: ' + className)
                    var moduleNames = currentCase.$.classname.split('.');
                    var classStatus = currentCase.$.result;
                    if (lastEndTime == 0) {
                        startTime = new Date(Date.parse(testRun.$['start-time'].replace(' ', '').replace('Z', '.000Z')));
                        console.log(startTime.toISOString());
                        startTime = startTime.toISOString();
                    } else {
                        startTime = lastEndTime;
                    }
                    interim = parseFloat(currentCase.$.duration);
                    console.log(interim);
                    endTime = new Date(Date.parse(startTime) + interim);
                    console.log(endTime.toISOString());
                    endTime = new Date(endTime).toISOString();

                    var note = '';
                    var stack = '';
                    var testFailure = currentCase.failure;
                    if (testFailure) {
                        console.log(testFailure.message)
                        note = testFailure.message;
                        console.log(testFailure['stack-trace'])
                        stack = testFailure['stack-trace'];
                    }

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

                    testLogs.push(testLog);
                    lastEndTime = endTime;
                }
            }
            if (currentSuite.hasOwnProperty('test-suite')) {
                var subSuite = Array.isArray(currentSuite['test-suite']) ? currentSuite['test-suite'] : [currentSuite['test-suite']]
                logLevel++;
                getCases(subSuite);
            }
        }

        return testCases;
    }
                
        var payload = body;
        var projectId = payload.projectId;
        var cycleId = payload.testcycle;
        var testLogs = [];

        let testResults = Buffer.from(payload.result, 'base64').toString('utf8');

        //console.log(testResults);

        var parseString = require('xml2js').parseString;
        var startTime = '';
        var endTime = '';

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
                    var testsuites = Array.isArray(result['test-run']['test-suite']) ? result['test-run']['test-suite'] : [result['test-run']['test-suite']];
                    getCases(testsuites);
                    } else {
                    console.log('Test Suites collection is empty, skipping.');
                }
        };

        var formattedResults = {
            "projectId" : projectId,
            "testcycle": cycleId,
            "logs" : testLogs
        };

        emitEvent('UpdateQTestWithFormattedResults', formattedResults );

});

function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}}