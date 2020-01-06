const request = require('request');
const { Webhooks } = require('@qasymphony/pulse-sdk');
const ScenarioSdk = require('@qasymphony/scenario-sdk');

const Features = {
    getIssueLinkByFeatureName(qtestToken, scenarioProjectId, name) {
        return new ScenarioSdk.Features({ qtestToken, scenarioProjectId }).getFeatures(`"${name}"`);
    }
};

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    // Specific to pulse actions
    var payload = body;

    var testLogs = payload.logs;
    var cycleId = payload.testcycle;
    var projectId = payload.projectId;
    var requiresDecode = payload.requiresDecode;

    if(requiresDecode == 'true') {
        testLogs = JSON.parse(testLogs);
    }

    var scenarioCount = 0;
    var scenarioList = "";

    var standardHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `bearer ${constants.QTEST_TOKEN}`
    }

    var createLogsAndTCs = function () {
        var opts = {
            url: "http://" + constants.ManagerURL + "/api/v3/projects/" + projectId + "/auto-test-logs?type=automation",
            json: true,
            headers: standardHeaders,
            body: {
                test_cycle: cycleId,
                test_logs: testLogs
            }
        };

        return request.post(opts, function (err, response, resbody) {

            if (err) {
                Promise.reject(err);
            }
            else {
                emitEvent('ChatOpsEvent', { message: resbody });

                if (response.body.type == "AUTOMATION_TEST_LOG") {
                    Promise.resolve("Uploaded results successfully");
                }
                else {
                    emitEvent('ChatOpsEvent', { message: "Wrong type" });
                    Promise.reject("Unable to upload test results");
                }
            }
        });
    };

    createLogsAndTCs()
        .on('response', function () {
            console.log("About to call Link Requirements Rule")
            emitEvent('<INSERT NAME OF LINK SCENARIO REQUIREMENTS RULE HERE>', payload);
        })
        .on('error', function (err) {
            emitEvent('ChatOpsEvent', { message: err });
        })
}
