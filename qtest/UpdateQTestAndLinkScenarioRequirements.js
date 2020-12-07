/*
 * trigger name: UpdateQTestAndLinkScenarioRequirements
 * call source: Cucumber Result Parser rules via emitEvent()
 * payload example:
        {
          "projectId": "5",
          "testcycle": "555555",
          "logs": [
            {
              "status": "passed",
              "name": "HEALTH CHECK: CME jlpv-cmeapp02",
              "attachments": [],
              "exe_start_date": "2020-10-30T14:56:22.357Z",
              "exe_end_date": "2020-10-30T14:56:22.357Z",
              "automation_content": "uniquely identfied string",
              "module_names": [
                "TEST CYCLE FOLDER NAME"
              ],
              "test_step_logs": [
                {
                  "description": "Step 1 description",
                  "expected_result": "Step 1 expected",
                  "actual_result": "Step 1 result",
                  "order": 1,
                  "status": "passed"
                },
                {
                  "description": "Step 2 description",
                  "expected_result": "Step 2 expected",
                  "actual_result": "Step 2 result",
                  "order": 2,
                  "status": "passed"
                },
                {
                  "description": "Step 3 description",
                  "expected_result": "Step 3 expected",
                  "actual_result": "Step 3 result",
                  "order": 3,
                  "status": "passed"
                }
                }
              ]
            }
          ]
        }
 * constants:
 *  QTEST_TOKEN: the qTest user bearer token from the API/SDK section of the 'Resources' area
        Ex. 02e74731-2f6e-4b95-b928-1596a68881e2
 *  Manager_URL: the base qTest Manager domain with no protocol information, https is expected by the script
        Ex. demo.qtestnet.com
 * outputs: standardized construct to be consumed by the qTest auto-test-logs API
 * external documentation: https://api.qasymphony.com/#/test-log/submitAutomationTestLogs2
 * Pulse events called: ChatOpsEvent, LinkScenarioRequirements
 */

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

    var payload = body;

    var testLogs = payload.logs;
    var cycleId = payload.testcycle;
    var projectId = payload.projectId;

    var standardHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `bearer ${constants.QTEST_TOKEN}`
    }

    var createLogsAndTCs = function () {
        var opts = {
            url: "https://" + constants.ManagerURL + "/api/v3/projects/" + projectId + "/auto-test-logs?type=automation",
            json: true,
            headers: standardHeaders,
            body: {
                test_cycle: cycleId,
                test_logs: testLogs
            }
        };

        return request.post(opts, function (err, response, resbody) {
            console.log('[INFO]: Response Body : ' + resbody);

            if (err) {
                Promise.reject(err);
                console.log('[ERROR]: ' + err);
            }
            else {
                emitEvent('ChatOpsEvent', { message: resbody });

                if (response.body.type == "AUTOMATION_TEST_LOG") {
                    Promise.resolve("[INFO]: ploaded results successfully.");
                }
                else {
                    emitEvent('ChatOpsEvent', { message: "Wrong type" });
                    Promise.reject("[ERROR]: Unable to upload test results.  See logs for details.");
                }
            }
        });
    };

    createLogsAndTCs()
        .on('response', function () {
            console.log("[INFO]: About to call Link Requirements Rule.")
            emitEvent('LinkScenarioRequirements', payload);
        })
        .on('error', function (err) {
            emitEvent('ChatOpsEvent', { message: err });
        })
}
