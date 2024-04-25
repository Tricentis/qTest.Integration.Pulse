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

const axios = require('axios');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }
    let queueId = 0;
    
    console.log(`[INFO]: About to process ${body.logs.length} results...`);
    emitEvent('ChatOpsEvent', { message: `[INFO]: About to process ${body.logs.length} results...`});

    let standardHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `bearer ${constants.QTEST_TOKEN}`
    }

    // Axios interceptor for global error handling
    axios.interceptors.response.use(
        response => response,
        error => {
            console.error(error);
            return Promise.reject(error);
        }
    );

    async function createLogsAndTCs() {
        let opts = {
            url: 'https://' + constants.ManagerURL + '/api/v3/projects/' + body.projectId + '/auto-test-logs?type=automation',
            method: 'post',
            headers: standardHeaders,
            data: {
                test_cycle: body.testcycle,
                test_logs: body.logs
            }
        };

        try {
            const response = await axios(opts);
            if (response.data.type == 'AUTOMATION_TEST_LOG') {
                queueId = response.data.id;
                emitEvent('ChatOpsEvent', { message: '[INFO]: Results queued successfully for id: ' + response.data.id});
                console.log('[INFO]: Results queued successfully for id: ' + response.data.id);
                emitEvent('CheckProcessingQueue', {'queueId': queueId});
            } else {
                emitEvent('ChatOpsEvent', { message: 'Unable to upload test results.' });
                console.error('[ERROR]: Unable to upload test results. See logs for details.');
                emitEvent('ChatOpsEvent', { message: '[ERROR]: ' + JSON.stringify(response.data) });
            }
        } catch (error) {
            console.error(error);
        }
    };

    await createLogsAndTCs();
}