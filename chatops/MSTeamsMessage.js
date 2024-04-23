const axios = require('axios');

/**
 * Trigger name: ChatOpsEvent
 * Call source: other Pulse Actions via emitEvent()
 * Payload example:
 *   {
 *     "message": "insert message contents here"
 *   }
 * Constants example:
 *  ChatOpsWebhook: 84d46c6a-d39d-11e9-bb65-2a2ae2dbcce4
 * Outputs:
 * - The "message" object in the payload will be sent to a configured Microsoft Teams webhook
 * Prerequisites: configured webhook connector for Microsoft Teams
 * External documentation: https://docs.microsoft.com/en-us/microsoftteams/platform/concepts/connectors/connectors-using
 */

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    try {
        const response = await axios.post(constants.ChatOpsWebhook, {
            text: body.message
        });

        console.log(`[INFO]: statusCode: ${response.status}`);
        //console.log(response.data);
    } catch (error) {
        console.error('[ERROR]: Error sending message to Microsoft Teams:', error);
    }
}
