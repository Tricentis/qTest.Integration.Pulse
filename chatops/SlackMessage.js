/**
 * trigger name: ChatOpsEvent
 * call source: other Pulse Actions via emitEvent()
 * payload example:
 *   {
 *     "message": "insert message contents here"
 *   }
 * constants example:
 *  ChatOpsWebhook: https://hooks.slack.com/services/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
 * outputs: the "message" object in the payload will be sent to a configured Slack webhook
 * prerequisites: configured webhook connector for Slack
 * external documentation: https://api.slack.com/incoming-webhooks 
 */

const axios = require('axios');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {

    let slack_webhook = constants.ChatOpsWebhook;

    //console.log('About to request slack webhook: ', slack_webhook);

    axios.post(slack_webhook, { "text": body.message })
        .then(response => {
            // Handle success
            //console.log(response.data);
            console.log(`[INFO]: statusCode: ${response.status}`);
        })
        .catch(error => {
            // Handle error
            console.error('[ERROR]: Error sending request to Slack webhook:', error);
        });
}