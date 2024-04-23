const axios = require('axios');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        return (t = triggers.find(t => t.name === name)) ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    const queueProcessing = ['IN_WAITING', 'IN_PROCESSING', 'PENDING'];
    let queueStatus = 'IN_WAITING'; // IN_WAITING, IN_PROCESSING, FAILED, PENDING and SUCCESS

    async function checkQueueStatus(id) {
        let opts = {
            url: 'https://' + constants.ManagerURL + '/api/v3/projects/queue-processing/' + id,
            method: 'get',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `bearer ${constants.QTEST_TOKEN}`
            }
        };

        try {
            const response = await axios(opts);
            queueStatus = response.data.state;
            emitEvent('ChatOpsEvent', { message: '[INFO]: Queue checked for id: ' + id + ', status is now: ' + queueStatus});
            console.log('[INFO]: Queue checked for id: ' + id + ', status is now: ' + queueStatus);
            if (queueStatus == 'FAILED') {
                emitEvent('ChatOpsEvent', { message: '[ERROR]: ' + response.data.content});
                console.error('[ERROR]: ' + response.data.content);
            }
        } catch (error) {
            console.error(error);
        }

        return;
    };

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    await checkQueueStatus(body.queueId);

    if (queueProcessing.includes(queueStatus))  {
        await sleep(10000);
        emitEvent('CheckProcessingQueue', {'queueId': body.queueId});
    };
};