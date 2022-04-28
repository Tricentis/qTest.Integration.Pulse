/*
 * trigger name: UpdateQTestWithResults
 * call source: any and all Result Parser rules via emitEvent()
 * payload example:
        {
          "projectId": "5",
          "testcycle": "555555",
          "logs": [
            {
              "status": "passed",
              "name": "Test 1 Name",
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
 *  ManagerURL: the base qTest Manager domain with no protocol information, https is expected by the script
        Ex. demo.qtestnet.com
 * outputs: standardized construct to be consumed by the qTest auto-test-logs API
 * external documentation: https://api.qasymphony.com/#/test-log/submitAutomationTestLogs2
 * Pulse events called: ChatOpsEvent
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
    var queueStatus = 'IN_WAITING'; // IN_WAITING, IN_PROCESSING, FAILED, PENDING and SUCCESS
    var queueId = 0;

    var standardHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `bearer ${constants.QTEST_TOKEN}`
    }

    function createLogsAndTCs() {
        var opts = {
            url: 'https://' + constants.ManagerURL + '/api/v3/projects/' + projectId + '/auto-test-logs?type=automation',
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
                console.log(err);
            }
            else {
                if (response.body.type == 'AUTOMATION_TEST_LOG') {
                  queueId = response.body.id;
                    Promise.resolve('Results queued successfully.');
                    emitEvent('ChatOpsEvent', { message: '[INFO]: Results queued successfully for id: ' + resbody.id});
                    console.log('[INFO]: Results queued successfully for id: ' + resbody.id);
                    checkQueueStatus(queueId);

                    //console.log('About to call Link Requirements Rule.');
                    //emitEvent('<INSERT NAME OF LINK SCENARIO REQUIREMENTS RULE HERE>', payload);
                }
                else {
                    emitEvent('ChatOpsEvent', { message: 'Unable to upload test results.' });
                    Promise.reject('[ERROR]: Unable to upload test results.  See logs for details.');
                    emitEvent('ChatOpsEvent', { message: '[ERROR]: ' + JSON.stringify(resbody) });
                    console.log('[ERROR]: ' + JSON.stringify(resbody));
                }
            }
        });
    };

    async function checkQueueStatus(id) {
        var opts = {
            url: 'https://' + constants.ManagerURL + '/api/v3/projects/queue-processing/' + id,
            json: true,
            headers: standardHeaders
        };
        
        var queueCounter = 0;
        const queueProcessing = ['IN_WAITING', 'IN_PROCESSING', 'PENDING'];

        await sleep(5000);

        while (queueProcessing.includes(queueStatus))  {

          await request(opts, function (err, response, resbody) {
              if (err) {
                  Promise.reject(err);
                  console.log(err);
                  return;
              }
              else {
                queueStatus = resbody.state;
                Promise.resolve('Queue checked successfully.');
                emitEvent('ChatOpsEvent', { message: '[INFO]: Queue checked for id: ' + id + ', status is now: ' + queueStatus});
                console.log('[INFO]: Queue checked for id: ' + id + ', status is now: ' + queueStatus);
                if (queueStatus == 'FAILED') {
                    emitEvent('ChatOpsEvent', { message: '[ERROR]: ' + resbody.content});
                    console.log('[ERROR]: ' + resbody.content);
                }
              }
          });

          queueCounter++;

          if(queueCounter > 30) {
            console.log('[WARNING]: Queue id: ' + id + ' is still in processing after 60 seconds, likely caused by heavy traffic.')
            return;
          } else {                
                await sleep(5000);
            }
        }
        return;
    };

    function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

    createLogsAndTCs();
}
