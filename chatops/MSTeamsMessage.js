/**
 * trigger name: ChatOpsEvent
 * call source: other Pulse Actions via emitEvent()
 * payload example:
 *   {
 *     "message": "insert message contents here"
 *   }
 * constants example:
 *  ChatOpsWebhook: 84d46c6a-d39d-11e9-bb65-2a2ae2dbcce4
 * outputs:
 * - the "message" object in the payload will be sent to a configured Microsoft Teams webhook
 * prerequisites: configured webhook connector for Microsoft Teams
 * external documentation: https://docs.microsoft.com/en-us/microsoftteams/platform/concepts/connectors/connectors-using
 */

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    var str = body;
    //console.log(str.message);

    var request = require('request');
    var teams_webhook = constants.ChatOpsWebhook;

    //console.log('About to request MS Teams webhook: ', teams_webhook);

    request({
        uri: teams_webhook,
        method: 'POST',
        json: { "text": str.message }
    }, function (error, response, body) { }
    );
}
